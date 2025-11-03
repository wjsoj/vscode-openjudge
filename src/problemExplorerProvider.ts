import * as vscode from 'vscode';
import { OpenJudgeApiClient } from './apiClient';
import { HtmlParser } from './htmlParser';
import { Practice, Problem } from './types';

type TreeItem = GroupTreeItem | PracticeTreeItem | ProblemTreeItem;

class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly subdomain: string,
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.tooltip = `${label} (${subdomain}.openjudge.cn)`;
  }
}

class PracticeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly practice: Practice,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(practice.name, collapsibleState);
    this.contextValue = practice.type;
    this.iconPath = new vscode.ThemeIcon(
      practice.type === 'contest' ? 'trophy' : 'book'
    );
    this.description = `${practice.problemCount} problems`;
    this.tooltip = practice.url;
  }
}

class ProblemTreeItem extends vscode.TreeItem {
  constructor(
    public readonly problem: Problem,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(`${problem.id}: ${problem.title}`, collapsibleState);
    this.contextValue = 'problem';
    this.iconPath = new vscode.ThemeIcon('file-code');

    if (problem.acceptanceRate) {
      this.description = `AC: ${problem.acceptanceRate}`;
    }

    this.tooltip = new vscode.MarkdownString(
      `**${problem.title}**\n\n` +
      `Problem ID: ${problem.id}\n` +
      (problem.acceptanceRate ? `Acceptance Rate: ${problem.acceptanceRate}\n` : '') +
      (problem.passedCount ? `Passed: ${problem.passedCount}\n` : '') +
      (problem.attemptCount ? `Attempts: ${problem.attemptCount}\n` : '') +
      `\n[Open Problem](${problem.url})`
    );

    this.command = {
      command: 'openjudge.viewProblem',
      title: 'View Problem',
      arguments: [this.problem]
    };
  }
}

export class ProblemExplorerProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private practiceCache: Map<string, Practice[]> = new Map();
  private problemCache: Map<string, Problem[]> = new Map();

  constructor(
    private apiClient: OpenJudgeApiClient,
    private context: vscode.ExtensionContext
  ) {}

  refresh(): void {
    this.practiceCache.clear();
    this.problemCache.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!this.apiClient.isLoggedIn()) {
      return [];
    }

    if (!element) {
      // Root level - show groups
      return this.getGroups();
    }

    if (element instanceof GroupTreeItem) {
      // Group level - show practices
      return this.getPractices(element.subdomain);
    }

    if (element instanceof PracticeTreeItem) {
      // Practice level - show problems
      return this.getProblems(element.practice);
    }

    return [];
  }

  private getGroups(): GroupTreeItem[] {
    // Get configured groups from settings
    const config = vscode.workspace.getConfiguration('openjudge');
    const configuredGroups = config.get<string[]>('groups', ['python']);

    return configuredGroups.map(subdomain =>
      new GroupTreeItem(
        subdomain,
        subdomain,
        vscode.TreeItemCollapsibleState.Collapsed
      )
    );
  }

  private async getPractices(subdomain: string): Promise<PracticeTreeItem[]> {
    // Check cache
    if (this.practiceCache.has(subdomain)) {
      const cached = this.practiceCache.get(subdomain)!;
      return cached.map(
        p => new PracticeTreeItem(p, vscode.TreeItemCollapsibleState.Collapsed)
      );
    }

    try {
      const html = await this.apiClient.fetchHtml(
        `http://${subdomain}.openjudge.cn/`
      );
      const practices = HtmlParser.parsePracticeList(html, subdomain);

      // Cache the results
      this.practiceCache.set(subdomain, practices);

      return practices.map(
        p => new PracticeTreeItem(p, vscode.TreeItemCollapsibleState.Collapsed)
      );
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to load practices: ${error.message}`);
      return [];
    }
  }

  private async getProblems(practice: Practice): Promise<ProblemTreeItem[]> {
    const cacheKey = `${practice.groupSubdomain}:${practice.id}`;

    console.log(`[ProblemExplorer] Getting problems for practice: ${practice.name} (${practice.id})`);
    console.log(`[ProblemExplorer] Cache key: ${cacheKey}`);
    console.log(`[ProblemExplorer] Practice URL: ${practice.url}`);

    // Check cache
    if (this.problemCache.has(cacheKey)) {
      const cached = this.problemCache.get(cacheKey)!;
      console.log(`[ProblemExplorer] Returning ${cached.length} cached problems`);
      return cached.map(
        p => new ProblemTreeItem(p, vscode.TreeItemCollapsibleState.None)
      );
    }

    try {
      console.log(`[ProblemExplorer] Fetching HTML from: ${practice.url}`);
      const html = await this.apiClient.fetchHtml(practice.url);
      console.log(`[ProblemExplorer] HTML fetched, length: ${html.length}`);

      const problems = HtmlParser.parseProblemList(
        html,
        practice.id,
        practice.groupSubdomain
      );

      console.log(`[ProblemExplorer] Parsed ${problems.length} problems`);

      // Cache the results
      this.problemCache.set(cacheKey, problems);

      return problems.map(
        p => new ProblemTreeItem(p, vscode.TreeItemCollapsibleState.None)
      );
    } catch (error: any) {
      console.error(`[ProblemExplorer] Failed to load problems:`, error);
      vscode.window.showErrorMessage(`Failed to load problems: ${error.message}`);
      return [];
    }
  }

  /**
   * Find a problem by ID
   */
  async findProblem(problemId: string, practiceId: string, subdomain: string): Promise<Problem | undefined> {
    const cacheKey = `${subdomain}:${practiceId}`;

    if (this.problemCache.has(cacheKey)) {
      return this.problemCache.get(cacheKey)!.find(p => p.id === problemId);
    }

    // Load problems from practice
    const practice: Practice = {
      id: practiceId,
      name: practiceId,
      groupSubdomain: subdomain,
      problemCount: 0,
      url: `http://${subdomain}.openjudge.cn/${practiceId}/`,
      type: 'practice'
    };

    await this.getProblems(practice);

    if (this.problemCache.has(cacheKey)) {
      return this.problemCache.get(cacheKey)!.find(p => p.id === problemId);
    }

    return undefined;
  }
}
