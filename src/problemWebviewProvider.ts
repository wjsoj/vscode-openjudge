import * as vscode from "vscode";
import { OpenJudgeApiClient } from "./apiClient";
import { HtmlParser } from "./htmlParser";
import { Problem, ProblemDetail } from "./types";

export class ProblemWebviewProvider {
  private static currentPanel: vscode.WebviewPanel | undefined;
  private static currentProblem: Problem | undefined;

  constructor(
    private apiClient: OpenJudgeApiClient,
    private context: vscode.ExtensionContext
  ) {}

  async showProblem(problem: Problem): Promise<void> {
    // If panel exists and showing same problem, just reveal it
    if (
      ProblemWebviewProvider.currentPanel &&
      ProblemWebviewProvider.currentProblem?.id === problem.id
    ) {
      ProblemWebviewProvider.currentPanel.reveal(vscode.ViewColumn.Two);
      return;
    }

    // Create or reuse panel
    if (ProblemWebviewProvider.currentPanel) {
      ProblemWebviewProvider.currentPanel.dispose();
    }

    const panel = vscode.window.createWebviewPanel(
      "openjudgeProblem",
      `Problem ${problem.id}: ${problem.title}`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      }
    );

    ProblemWebviewProvider.currentPanel = panel;
    ProblemWebviewProvider.currentProblem = problem;

    // Show loading
    panel.webview.html = this.getLoadingHtml();

    try {
      // Fetch problem detail
      const html = await this.apiClient.fetchHtml(problem.url);
      const detail = HtmlParser.parseProblemDetail(html, problem.id);

      // Update webview with problem content
      panel.webview.html = this.getProblemHtml(problem, detail);

      // Handle messages from webview
      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case "copyInput":
              await vscode.env.clipboard.writeText(message.text);
              vscode.window.showInformationMessage(
                "Sample input copied to clipboard"
              );
              break;
            case "copyOutput":
              await vscode.env.clipboard.writeText(message.text);
              vscode.window.showInformationMessage(
                "Sample output copied to clipboard"
              );
              break;
          }
        },
        undefined,
        this.context.subscriptions
      );

      // Clean up on disposal
      panel.onDidDispose(
        () => {
          ProblemWebviewProvider.currentPanel = undefined;
          ProblemWebviewProvider.currentProblem = undefined;
        },
        null,
        this.context.subscriptions
      );
    } catch (error: any) {
      panel.webview.html = this.getErrorHtml(error.message);
    }
  }

  private getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading...</title>
    <style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
        }
        .spinner {
            border: 4px solid var(--vscode-progressBar-background);
            border-top: 4px solid var(--vscode-button-background);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div>
        <div class="spinner"></div>
        <p style="text-align: center; margin-top: 20px;">Loading problem...</p>
    </div>
</body>
</html>`;
  }

  private getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-errorForeground);
            padding: 20px;
        }
    </style>
</head>
<body>
    <h1>Error Loading Problem</h1>
    <p>${error}</p>
</body>
</html>`;
  }

  private getProblemHtml(problem: Problem, detail: ProblemDetail): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>${detail.title}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        h1 {
            color: var(--vscode-foreground);
            border-bottom: 2px solid var(--vscode-button-background);
            padding-bottom: 10px;
        }
        h2 {
            color: var(--vscode-textLink-foreground);
            margin-top: 20px;
        }
        .metadata {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 10px;
            border-radius: 5px;
            margin-bottom: 20px;
            display: flex;
            gap: 20px;
        }
        .metadata-item {
            display: flex;
            flex-direction: column;
        }
        .metadata-label {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            font-size: 0.9em;
        }
        .metadata-value {
            margin-top: 4px;
        }
        pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
            border: 1px solid var(--vscode-widget-border);
        }
        .sample-box {
            margin: 10px 0;
            position: relative;
        }
        .copy-btn {
            position: absolute;
            top: 5px;
            right: 5px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 5px 10px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 0.85em;
        }
        .copy-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .submit-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 20px;
            font-size: 1em;
            cursor: pointer;
            border-radius: 5px;
            margin-top: 20px;
        }
        .submit-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .section {
            margin: 20px 0;
        }
        .url-link {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            font-size: 0.9em;
        }
        .url-link:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <h1>${detail.id}: ${detail.title}</h1>

    <div class="metadata">
        <div class="metadata-item">
            <span class="metadata-label">Time Limit</span>
            <span class="metadata-value">${detail.timeLimit}</span>
        </div>
        <div class="metadata-item">
            <span class="metadata-label">Memory Limit</span>
            <span class="metadata-value">${detail.memoryLimit}</span>
        </div>
        ${
          detail.globalId
            ? `
        <div class="metadata-item">
            <span class="metadata-label">Global ID</span>
            <span class="metadata-value">${detail.globalId}</span>
        </div>
        `
            : ""
        }
    </div>

    <p><a href="${problem.url}" class="url-link">View on OpenJudge ↗</a></p>

    <div class="section">
        <h2>Description</h2>
        <div>${detail.description}</div>
    </div>

    <div class="section">
        <h2>Input</h2>
        <div>${detail.input}</div>
    </div>

    <div class="section">
        <h2>Output</h2>
        <div>${detail.output}</div>
    </div>

    <div class="section">
        <h2>Sample Input</h2>
        <div class="sample-box">
            <button class="copy-btn" onclick="copyInput()">Copy</button>
            <pre>${this.escapeHtml(detail.sampleInput)}</pre>
        </div>
    </div>

    <div class="section">
        <h2>Sample Output</h2>
        <div class="sample-box">
            <button class="copy-btn" onclick="copyOutput()">Copy</button>
            <pre>${this.escapeHtml(detail.sampleOutput)}</pre>
        </div>
    </div>

    ${
      detail.hint
        ? `
    <div class="section">
        <h2>Hint</h2>
        <div>${detail.hint}</div>
    </div>
    `
        : ""
    }

    ${
      detail.source
        ? `
    <div class="section">
        <h2>Source</h2>
        <div>${detail.source}</div>
    </div>
    `
        : ""
    }

    <script>
        const vscode = acquireVsCodeApi();

        function copyInput() {
            vscode.postMessage({
                command: 'copyInput',
                text: ${JSON.stringify(detail.sampleInput)}
            });
        }

        function copyOutput() {
            vscode.postMessage({
                command: 'copyOutput',
                text: ${JSON.stringify(detail.sampleOutput)}
            });
        }
    </script>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  static getCurrentProblem(): Problem | undefined {
    return ProblemWebviewProvider.currentProblem;
  }
}
