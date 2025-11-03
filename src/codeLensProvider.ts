import * as vscode from 'vscode';

export class OpenJudgeCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor(private context: vscode.ExtensionContext) {}

  public provideCodeLenses(
    document: vscode.TextDocument
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];

    // Check if this file has an associated problem
    const fileUri = document.uri.toString();
    const problem = this.context.workspaceState.get(`problem:${fileUri}`);

    // Only show CodeLens if a problem is associated
    if (!problem) {
      return codeLenses;
    }

    // Add a code lens at the top of the file (line 0)
    const topOfDocument = new vscode.Range(0, 0, 0, 0);

    // Submit button
    const submitCommand: vscode.Command = {
      title: '$(cloud-upload) Submit to OpenJudge',
      command: 'openjudge.submitSolution',
      arguments: []
    };

    codeLenses.push(new vscode.CodeLens(topOfDocument, submitCommand));

    // Show problem info
    const problemInfo = problem as any;
    const infoCommand: vscode.Command = {
      title: `$(info) Problem: ${problemInfo.id} - ${problemInfo.title}`,
      command: 'openjudge.viewProblem',
      arguments: [problem]
    };

    codeLenses.push(new vscode.CodeLens(topOfDocument, infoCommand));

    return codeLenses;
  }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }
}
