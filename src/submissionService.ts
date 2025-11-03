import * as vscode from 'vscode';
import { OpenJudgeApiClient } from './apiClient';
import { HtmlParser } from './htmlParser';
import { Problem, SubmitRequest } from './types';
import { ProblemExplorerProvider } from './problemExplorerProvider';

export class SubmissionService {
  constructor(
    private apiClient: OpenJudgeApiClient,
    private context: vscode.ExtensionContext,
    private problemExplorerProvider: ProblemExplorerProvider
  ) {}

  async submitSolution(problem?: Problem): Promise<void> {
    // If no problem provided, try to get from file metadata or current webview
    if (!problem) {
      // Try to get from file metadata first
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const fileUri = editor.document.uri.toString();
        problem = this.context.workspaceState.get<Problem>(`problem:${fileUri}`);
      }

      // If still no problem, try to get current problem from webview
      if (!problem) {
        const { ProblemWebviewProvider } = await import('./problemWebviewProvider');
        problem = ProblemWebviewProvider.getCurrentProblem();
      }
    }

    if (!problem) {
      const action = await vscode.window.showErrorMessage(
        '未关联题目。请先选择一个题目。',
        '选择题目'
      );
      if (action === '选择题目') {
        vscode.commands.executeCommand('openjudge.pickProblem');
      }
      return;
    }

    // Get active text editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('未找到活动编辑器。请打开一个代码文件。');
      return;
    }

    const code = editor.document.getText();
    if (!code.trim()) {
      vscode.window.showErrorMessage('代码不能为空。');
      return;
    }

    // Detect language from file extension or use preferred language
    const languageId = editor.document.languageId;
    let language = this.getLanguageForSubmission(languageId);

    if (!language) {
      // Try to use preferred language from config
      const config = vscode.workspace.getConfiguration('openjudge');
      const preferredLanguage = config.get<string>('preferredLanguage');

      if (preferredLanguage) {
        language = preferredLanguage;
      } else {
        // Ask user to select
        const selectedLanguage = await vscode.window.showQuickPick(
          ['Python3', 'C++', 'C', 'Java', 'C++11', 'Pascal', 'Go'],
          {
            placeHolder: '选择编程语言'
          }
        );

        if (!selectedLanguage) {
          return;
        }
        language = selectedLanguage;
      }
    }

    // Get contest ID from submit page
    let contestId = problem.contestId;
    if (!contestId) {
      // Fetch from problem submit page
      try {
        const submitPageUrl = `http://${problem.groupSubdomain}.openjudge.cn/${problem.practiceId}/${problem.id}/submit/`;
        console.log('Fetching contest ID from submit page:', submitPageUrl);

        const html = await this.apiClient.fetchHtml(submitPageUrl);
        contestId = HtmlParser.extractContestId(html);

        if (contestId) {
          console.log('Extracted contestId from submit page:', contestId);
        } else {
          console.error('Failed to extract contestId from submit page');
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`获取比赛 ID 失败: ${error.message}`);
        return;
      }
    }

    if (!contestId) {
      vscode.window.showErrorMessage(
        '无法确定该题目的比赛 ID。提交页面可能不包含所需信息。'
      );
      return;
    }

    // Encode code to base64
    const base64Code = Buffer.from(code).toString('base64');

    console.log('[SubmissionService] Code length:', code.length);
    console.log('[SubmissionService] Base64 length:', base64Code.length);
    console.log('[SubmissionService] Base64 preview:', base64Code.substring(0, 50));

    // Prepare submission
    const submitRequest: SubmitRequest = {
      contestId,
      problemNumber: problem.id,
      language: language || 'Python3',
      source: base64Code,  // Don't encode again - URLSearchParams will do it
      sourceEncode: 'base64'
    };

    // Show progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `正在提交题目 ${problem.id} 的解答...`,
        cancellable: false
      },
      async () => {
        try {
          const response = await this.apiClient.submitSolution(
            problem.groupSubdomain,
            submitRequest
          );

          if (response.result === 'SUCCESS') {
            vscode.window.showInformationMessage(
              `✓ ${response.message}`
            );

            // Automatically show submission status
            if (response.redirect) {
              await this.showSubmissionStatus(response.redirect, problem);
            }
          } else {
            vscode.window.showErrorMessage(`✗ ${response.message}`);
          }
        } catch (error: any) {
          vscode.window.showErrorMessage(`提交失败: ${error.message}`);
        }
      }
    );
  }

  private getLanguageForSubmission(languageId: string): string | undefined {
    const languageMap: Record<string, string> = {
      'python': 'Python3',
      'cpp': 'C++',
      'c': 'C',
      'java': 'Java'
    };

    return languageMap[languageId];
  }

  private async showSubmissionStatus(redirectUrl: string, problem: Problem): Promise<void> {
    const submissionId = redirectUrl.split('/').filter(Boolean).pop();

    if (!submissionId) {
      vscode.window.showErrorMessage('无法提取提交 ID');
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'openjudgeSubmission',
      `提交 ${submissionId}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    // Start polling for status
    const pollingInterval = vscode.workspace.getConfiguration('openjudge')
      .get<number>('submissionPollingInterval', 2000);

    let attempts = 0;
    const maxAttempts = 30; // Poll for 1 minute max
    // eslint-disable-next-line prefer-const
    let interval: NodeJS.Timeout | undefined; // Declare interval first

    const updateStatus = async () => {
      try {
        const html = await this.apiClient.fetchHtml(redirectUrl);
        const status = HtmlParser.parseSubmissionStatus(html, submissionId);

        panel.webview.html = this.getSubmissionStatusHtml(status, problem);

        // Stop polling if status is final
        const finalStatuses = ['Accepted', 'Wrong Answer', 'Time Limit Exceeded',
                               'Memory Limit Exceeded', 'Runtime Error',
                               'Compile Error', 'Presentation Error'];

        if (finalStatuses.includes(status.status) || attempts >= maxAttempts) {
          if (interval) {
            clearInterval(interval);
          }
        }

        attempts++;
      } catch (error: any) {
        panel.webview.html = `<html><body><h1>Error</h1><p>${error.message}</p></body></html>`;
        if (interval) {
          clearInterval(interval);
        }
      }
    };

    // Initial update
    await updateStatus();

    // Start polling
    interval = setInterval(updateStatus, pollingInterval);

    // Clean up on disposal
    panel.onDidDispose(() => {
      if (interval) {
        clearInterval(interval);
      }
    }, null, this.context.subscriptions);
  }

  private getSubmissionStatusHtml(status: any, problem: Problem): string {
    const statusColor = this.getStatusColor(status.status);
    const statusIcon = this.getStatusIcon(status.status);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <title>Submission ${status.id}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        h1 {
            border-bottom: 2px solid var(--vscode-button-background);
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .status-banner {
            background: linear-gradient(135deg, ${statusColor}22 0%, ${statusColor}11 100%);
            border-left: 4px solid ${statusColor};
            padding: 20px;
            margin: 20px 0;
            border-radius: 4px;
        }
        .status {
            font-size: 1.8em;
            font-weight: bold;
            color: ${statusColor};
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .status-icon {
            font-size: 1.2em;
        }
        .info-section {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 15px;
            border-radius: 4px;
            margin: 20px 0;
        }
        .info-grid {
            display: grid;
            grid-template-columns: 140px 1fr;
            gap: 12px;
            margin: 15px 0;
        }
        .info-label {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .info-value {
            color: var(--vscode-foreground);
        }
        .code-section {
            margin-top: 30px;
        }
        .code-section h2 {
            color: var(--vscode-textLink-foreground);
            margin-bottom: 10px;
        }
        pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
            border: 1px solid var(--vscode-widget-border);
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 0.9em;
            line-height: 1.5;
        }
        .error-message {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-errorForeground);
            padding: 15px;
            border-radius: 4px;
            margin: 20px 0;
        }
        .metrics {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            margin: 15px 0;
        }
        .metric {
            background-color: var(--vscode-button-secondaryBackground);
            padding: 10px 15px;
            border-radius: 4px;
            flex: 1;
            min-width: 120px;
        }
        .metric-label {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 5px;
        }
        .metric-value {
            font-size: 1.2em;
            font-weight: bold;
            color: var(--vscode-foreground);
        }
    </style>
</head>
<body>
    <h1>提交 #${status.id}</h1>

    <div class="status-banner">
        <div class="status">
            <span class="status-icon">${statusIcon}</span>
            <span>${status.status || 'Pending...'}</span>
        </div>
    </div>

    <div class="info-section">
        <div class="info-grid">
            <div class="info-label">题目:</div>
            <div class="info-value">${status.problemId || problem.id}: ${problem.title}</div>

            <div class="info-label">语言:</div>
            <div class="info-value">${status.language || 'N/A'}</div>

            ${status.submitter ? `
            <div class="info-label">提交人:</div>
            <div class="info-value">${this.escapeHtml(status.submitter)}</div>
            ` : ''}

            <div class="info-label">提交时间:</div>
            <div class="info-value">${status.submitTime || 'N/A'}</div>
        </div>

        ${status.time || status.memory ? `
        <div class="metrics">
            ${status.time ? `
            <div class="metric">
                <div class="metric-label">运行时间</div>
                <div class="metric-value">${status.time}</div>
            </div>
            ` : ''}
            ${status.memory ? `
            <div class="metric">
                <div class="metric-label">内存使用</div>
                <div class="metric-value">${status.memory}</div>
            </div>
            ` : ''}
        </div>
        ` : ''}
    </div>

    ${status.errorMessage ? `
    <div class="error-message">
        <h3 style="margin-top: 0;">编译/运行错误</h3>
        <pre>${this.escapeHtml(status.errorMessage)}</pre>
    </div>
    ` : ''}

    ${status.code ? `
    <div class="code-section">
        <h2>源代码</h2>
        <pre>${this.escapeHtml(status.code)}</pre>
    </div>
    ` : ''}
</body>
</html>`;
  }

  private getStatusIcon(status: string): string {
    const iconMap: Record<string, string> = {
      'Accepted': '✅',
      'Wrong Answer': '❌',
      'Time Limit Exceeded': '⏱️',
      'Memory Limit Exceeded': '💾',
      'Runtime Error': '⚠️',
      'Compile Error': '🔧',
      'Presentation Error': '📄',
      'Pending': '⏳',
      'Running': '▶️'
    };

    // Handle Judging status separately to avoid ESLint warning
    if (status === 'Judging') {
      return '⚖️';
    }

    return iconMap[status] || '📋';
  }

  private getStatusColor(status: string): string {
    const colorMap: Record<string, string> = {
      'Accepted': '#4caf50',
      'Wrong Answer': '#f44336',
      'Time Limit Exceeded': '#ff9800',
      'Memory Limit Exceeded': '#ff9800',
      'Runtime Error': '#f44336',
      'Compile Error': '#f44336',
      'Presentation Error': '#ff9800',
      'Pending': '#2196f3',
      'Running': '#2196f3'
    };

    return colorMap[status] || 'var(--vscode-foreground)';
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}
