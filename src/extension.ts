import * as vscode from 'vscode';
import { OpenJudgeApiClient } from './apiClient';
import { ProblemExplorerProvider } from './problemExplorerProvider';
import { ProblemWebviewProvider } from './problemWebviewProvider';
import { SubmissionService } from './submissionService';
import { OpenJudgeCodeLensProvider } from './codeLensProvider';
import { Problem } from './types';

let apiClient: OpenJudgeApiClient;
let problemExplorerProvider: ProblemExplorerProvider;
let problemWebviewProvider: ProblemWebviewProvider;
let submissionService: SubmissionService;
let codeLensProvider: OpenJudgeCodeLensProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('OpenJudge extension is now active');

  // Initialize services
  apiClient = new OpenJudgeApiClient(context);
  problemExplorerProvider = new ProblemExplorerProvider(apiClient, context);
  problemWebviewProvider = new ProblemWebviewProvider(apiClient, context);
  submissionService = new SubmissionService(apiClient, context, problemExplorerProvider);
  codeLensProvider = new OpenJudgeCodeLensProvider(context);

  // Register tree view provider
  const treeView = vscode.window.createTreeView('openjudge.problemExplorer', {
    treeDataProvider: problemExplorerProvider,
    showCollapseAll: true
  });

  context.subscriptions.push(treeView);

  // Register CodeLens provider for all supported languages
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    [
      { language: 'python' },
      { language: 'cpp' },
      { language: 'c' },
      { language: 'java' },
      { language: 'javascript' },
      { language: 'typescript' }
    ],
    codeLensProvider
  );
  context.subscriptions.push(codeLensDisposable);

  // Register commands
  registerCommands(context);

  // Initialize apiClient and check login status
  apiClient.initialize().then(async () => {
    // Try auto-login if have saved credentials
    if (!apiClient.isLoggedIn()) {
      const savedCredentials = context.globalState.get<{email: string; password: string}>('openjudge.credentials');

      if (savedCredentials) {
        console.log('Attempting auto-login with saved credentials');
        const response = await apiClient.loginWithPassword();

        if (response.result === 'SUCCESS') {
          console.log('Auto-login successful');

          // Apply interface language setting
          const config = vscode.workspace.getConfiguration('openjudge');
          const interfaceLanguage = config.get<'en_US' | 'zh_CN'>('interfaceLanguage', 'zh_CN');
          await apiClient.switchLanguage(interfaceLanguage);
        } else {
          console.log('Auto-login failed:', response.message);
        }
      }
    }

    // Auto-refresh if enabled and logged in
    const config = vscode.workspace.getConfiguration('openjudge');
    if (config.get<boolean>('autoRefresh', true) && apiClient.isLoggedIn()) {
      problemExplorerProvider.refresh();
    }

    // Show welcome message if still not logged in
    if (!apiClient.isLoggedIn()) {
      vscode.window.showInformationMessage(
        '欢迎使用 OpenJudge！请先登录以开始使用。',
        '登录'
      ).then(selection => {
        if (selection === '登录') {
          vscode.commands.executeCommand('openjudge.login');
        }
      });
    }
  });
}

function registerCommands(context: vscode.ExtensionContext) {
  // Configuration command
  context.subscriptions.push(
    vscode.commands.registerCommand('openjudge.configure', async () => {
      await showConfigurationDialog(context);
    })
  );

  // Login command
  context.subscriptions.push(
    vscode.commands.registerCommand('openjudge.login', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '正在登录 OpenJudge...',
          cancellable: false
        },
        async () => {
          const response = await apiClient.loginWithPassword();

          if (response.result === 'SUCCESS') {
            vscode.window.showInformationMessage(`✓ ${response.message}`);

            // Check if user has configured settings
            const hasConfigured = context.globalState.get<boolean>('openjudge.hasConfigured');
            if (!hasConfigured) {
              const configure = await vscode.window.showInformationMessage(
                '是否配置 OpenJudge 偏好设置？',
                '配置',
                '稍后'
              );

              if (configure === '配置') {
                await showConfigurationDialog(context);
              }
            }

            // Apply interface language setting
            const config = vscode.workspace.getConfiguration('openjudge');
            const interfaceLanguage = config.get<'en_US' | 'zh_CN'>('interfaceLanguage', 'zh_CN');
            await apiClient.switchLanguage(interfaceLanguage);

            problemExplorerProvider.refresh();
          } else {
            vscode.window.showErrorMessage(`✗ ${response.message}`);
          }
        }
      );
    })
  );

  // Logout command
  context.subscriptions.push(
    vscode.commands.registerCommand('openjudge.logout', async () => {
      const confirm = await vscode.window.showWarningMessage(
        '确定要退出登录吗？',
        '确定',
        '取消'
      );

      if (confirm === '确定') {
        await apiClient.clearSession();
        problemExplorerProvider.refresh();
        vscode.window.showInformationMessage('已退出登录');
      }
    })
  );

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('openjudge.refresh', () => {
      problemExplorerProvider.refresh();
      vscode.window.showInformationMessage('题目列表已刷新');
    })
  );

  // View problem command
  context.subscriptions.push(
    vscode.commands.registerCommand('openjudge.viewProblem', async (problem: Problem) => {
      await problemWebviewProvider.showProblem(problem);

      // Auto-associate problem with currently active editor if it exists
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const fileUri = editor.document.uri.toString();
        // Only associate if not already associated
        const existingProblem = context.workspaceState.get(`problem:${fileUri}`);
        if (!existingProblem) {
          await context.workspaceState.update(`problem:${fileUri}`, problem);
          console.log(`Auto-associated problem ${problem.id} with file ${fileUri}`);
          // Refresh CodeLens
          codeLensProvider.refresh();
          vscode.window.showInformationMessage(
            `题目 ${problem.id} 已关联到当前文件`
          );
        }
      }
    })
  );

  // Submit solution command
  context.subscriptions.push(
    vscode.commands.registerCommand('openjudge.submitSolution', async (problem?: Problem) => {
      await submissionService.submitSolution(problem);
    })
  );

  // Pick problem command (for CodeLens)
  context.subscriptions.push(
    vscode.commands.registerCommand('openjudge.pickProblem', async () => {
      if (!apiClient.isLoggedIn()) {
        vscode.window.showErrorMessage('请先登录 OpenJudge');
        return;
      }

      // Get all groups
      const config = vscode.workspace.getConfiguration('openjudge');
      const groups = config.get<string[]>('groups', ['python']);

      // Let user pick a group
      const selectedGroup = await vscode.window.showQuickPick(groups, {
        placeHolder: '选择小组',
        ignoreFocusOut: true
      });

      if (!selectedGroup) {
        return;
      }

      // Get practices for the group
      vscode.window.showInformationMessage('正在加载练习列表...');

      try {
        const html = await apiClient.fetchHtml(`http://${selectedGroup}.openjudge.cn/`);
        const { HtmlParser } = await import('./htmlParser');
        const practices = HtmlParser.parsePracticeList(html, selectedGroup);

        if (practices.length === 0) {
          vscode.window.showWarningMessage('未找到该小组的练习');
          return;
        }

        // Let user pick a practice
        const selectedPractice = await vscode.window.showQuickPick(
          practices.map(p => ({
            label: p.name,
            description: `${p.problemCount} 题`,
            practice: p
          })),
          {
            placeHolder: '选择练习/比赛',
            ignoreFocusOut: true
          }
        );

        if (!selectedPractice) {
          return;
        }

        // Get problems for the practice
        vscode.window.showInformationMessage('正在加载题目列表...');
        const practiceHtml = await apiClient.fetchHtml(selectedPractice.practice.url);
        const problems = HtmlParser.parseProblemList(
          practiceHtml,
          selectedPractice.practice.id,
          selectedGroup
        );

        if (problems.length === 0) {
          vscode.window.showWarningMessage('该练习中未找到题目');
          return;
        }

        // Let user pick a problem
        const selectedProblem = await vscode.window.showQuickPick(
          problems.map(p => ({
            label: `${p.id}: ${p.title}`,
            description: p.acceptanceRate ? `通过率: ${p.acceptanceRate}` : '',
            problem: p
          })),
          {
            placeHolder: '选择题目',
            ignoreFocusOut: true
          }
        );

        if (!selectedProblem) {
          return;
        }

        // Store the selected problem in the current file's metadata
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const fileUri = editor.document.uri.toString();
          await context.workspaceState.update(`problem:${fileUri}`, selectedProblem.problem);
          // Refresh CodeLens
          codeLensProvider.refresh();
          vscode.window.showInformationMessage(
            `✓ 题目 ${selectedProblem.problem.id} 已关联到当前文件`
          );
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`加载题目失败: ${error.message}`);
      }
    })
  );

  // View submissions command (future enhancement)
  context.subscriptions.push(
    vscode.commands.registerCommand('openjudge.viewSubmissions', () => {
      vscode.window.showInformationMessage('查看提交记录功能即将推出！');
    })
  );

  // Status bar item for current problem
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = '$(code) OpenJudge';
  statusBarItem.tooltip = 'OpenJudge Extension';
  statusBarItem.command = 'openjudge.refresh';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

async function showConfigurationDialog(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('openjudge');

  // Step 1: Input group subdomains
  const groupsInput = await vscode.window.showInputBox({
    prompt: '输入 OpenJudge 小组子域名（逗号分隔）',
    placeHolder: '例如: python, 21jgc13, noi',
    value: config.get<string[]>('groups', ['python']).join(', '),
    ignoreFocusOut: true
  });

  if (!groupsInput) {
    return;
  }

  const groups = groupsInput
    .split(',')
    .map(g => g.trim())
    .filter(g => g.length > 0);

  // Step 2: Select preferred programming language
  const language = await vscode.window.showQuickPick(
    ['Python3', 'C++', 'C', 'Java', 'C++11', 'Pascal', 'Go'],
    {
      placeHolder: '选择首选编程语言',
      ignoreFocusOut: true
    }
  );

  if (!language) {
    return;
  }

  // Step 3: Select interface language
  const interfaceLang = await vscode.window.showQuickPick(
    [
      { label: 'zh_CN', description: '简体中文' },
      { label: 'en_US', description: 'English' }
    ],
    {
      placeHolder: '选择界面语言',
      ignoreFocusOut: true
    }
  );

  if (!interfaceLang) {
    return;
  }

  // Save configuration
  await config.update('groups', groups, vscode.ConfigurationTarget.Global);
  await config.update('preferredLanguage', language, vscode.ConfigurationTarget.Global);
  await config.update('interfaceLanguage', interfaceLang.label, vscode.ConfigurationTarget.Global);
  await context.globalState.update('openjudge.hasConfigured', true);

  // Apply interface language if logged in
  if (apiClient.isLoggedIn()) {
    await apiClient.switchLanguage(interfaceLang.label as 'en_US' | 'zh_CN');
  }

  vscode.window.showInformationMessage('配置已保存');
  problemExplorerProvider.refresh();
}

export function deactivate() {
  console.log('OpenJudge extension is now deactivated');

  // Dispose API client
  if (apiClient) {
    apiClient.dispose();
  }
}
