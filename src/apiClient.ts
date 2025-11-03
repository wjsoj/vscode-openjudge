import * as vscode from "vscode";
import { request, Agent } from "undici";
import { createGunzip } from "zlib";
import {
  AuthResponse,
  SubmitRequest,
  SubmitResponse,
  CookieSession,
} from "./types";

/**
 * Cookie jar for managing HTTP cookies across requests
 */
class CookieJar {
  private cookies: Map<
    string,
    { value: string; domain: string; path: string }
  > = new Map();

  /**
   * Parse and store cookies from Set-Cookie headers
   */
  setCookie(setCookieHeader: string | string[], domain: string): void {
    const headers = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : [setCookieHeader];

    for (const header of headers) {
      const parts = header.split(";").map((p) => p.trim());
      const [nameValue] = parts;
      const [name, value] = nameValue.split("=");

      let cookiePath = "/";
      let cookieDomain = domain;

      for (const part of parts.slice(1)) {
        if (part.toLowerCase().startsWith("path=")) {
          cookiePath = part.substring(5);
        } else if (part.toLowerCase().startsWith("domain=")) {
          cookieDomain = part.substring(7);
        }
      }

      this.cookies.set(name, { value, domain: cookieDomain, path: cookiePath });
    }
  }

  /**
   * Get cookies as a Cookie header string for a given domain
   */
  getCookieHeader(domain: string): string {
    const relevantCookies: string[] = [];

    for (const [name, cookie] of this.cookies.entries()) {
      if (domain.includes(cookie.domain) || cookie.domain.includes(domain)) {
        relevantCookies.push(`${name}=${cookie.value}`);
      }
    }

    return relevantCookies.join("; ");
  }

  /**
   * Set a specific cookie
   */
  set(
    name: string,
    value: string,
    domain: string = "openjudge.cn",
    path: string = "/"
  ): void {
    this.cookies.set(name, { value, domain, path });
  }

  /**
   * Get a specific cookie value
   */
  get(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }

  /**
   * Clear all cookies
   */
  clear(): void {
    this.cookies.clear();
  }

  /**
   * Export cookies for persistence
   */
  export(): Array<[string, { value: string; domain: string; path: string }]> {
    return Array.from(this.cookies.entries());
  }

  /**
   * Import cookies from persistence
   */
  import(
    data: Array<[string, { value: string; domain: string; path: string }]>
  ): void {
    this.cookies = new Map(data);
  }
}

/**
 * OpenJudge API Client with proper session management
 */
export class OpenJudgeApiClient {
  private session: CookieSession | null = null;
  private readonly baseUrl = "http://openjudge.cn";
  private cookieJar: CookieJar = new CookieJar();
  private agent: Agent;

  constructor(private context: vscode.ExtensionContext) {
    // Create a persistent HTTP agent with keep-alive
    this.agent = new Agent({
      keepAliveTimeout: 30000,
      keepAliveMaxTimeout: 60000,
      connections: 10,
    });

    // Load saved session synchronously
    this.loadSessionSync();
  }

  /**
   * Initialize session (call this before first use)
   */
  async initialize(): Promise<void> {
    await this.loadSession();

    // If we have a session, initialize the cookie jar
    if (this.session) {
      this.cookieJar.set("PHPSESSID", this.session.PHPSESSID, "openjudge.cn");
      this.cookieJar.set("language", this.session.language, "openjudge.cn");

      // Load saved cookie jar if available
      const savedCookieJar = this.context.globalState.get<Array<[string, any]>>(
        "openjudge.cookieJar"
      );
      if (savedCookieJar) {
        this.cookieJar.import(savedCookieJar);
      }
    }
  }

  /**
   * Build complete browser-like headers
   */
  private buildHeaders(
    url: string,
    additionalHeaders: Record<string, string> = {}
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Upgrade-Insecure-Requests": "1",
      ...additionalHeaders,
    };

    // Add cookies
    const domain = new URL(url).hostname;
    const cookieHeader = this.cookieJar.getCookieHeader(domain);
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    return headers;
  }

  /**
   * Make an HTTP request with proper session management
   */
  private async makeRequest(
    url: string,
    options: {
      method?: "GET" | "POST";
      headers?: Record<string, string>;
      body?: string;
    } = {}
  ): Promise<{ body: string; headers: any; statusCode: number }> {
    const method = options.method || "GET";
    const headers = this.buildHeaders(url, options.headers);

    console.log(`[HTTP ${method}]`, url);
    console.log("[Headers]", JSON.stringify(headers, null, 2));
    if (options.body) {
      console.log("[Body]", options.body.substring(0, 200));
    }

    try {
      const response = await request(url, {
        method,
        headers,
        body: options.body,
        dispatcher: this.agent,
      });

      const statusCode = response.statusCode;
      const responseHeaders = response.headers;

      // Handle cookies from response
      const setCookie = responseHeaders["set-cookie"];
      if (setCookie) {
        const domain = new URL(url).hostname;
        this.cookieJar.setCookie(setCookie, domain);

        // Save cookie jar
        await this.context.globalState.update(
          "openjudge.cookieJar",
          this.cookieJar.export()
        );
      }

      // Read response body and handle compression
      let body = "";
      const contentEncoding = responseHeaders["content-encoding"];

      if (contentEncoding === "gzip" || contentEncoding === "deflate") {
        // Handle compressed response
        console.log(
          "[Response] Decompressing",
          contentEncoding,
          "encoded content"
        );
        const chunks: Buffer[] = [];
        for await (const chunk of response.body) {
          chunks.push(Buffer.from(chunk));
        }
        const compressedBuffer = Buffer.concat(chunks);

        // Decompress using zlib
        const gunzip = createGunzip();
        const decompressed: Buffer[] = [];

        gunzip.on("data", (chunk) => {
          decompressed.push(chunk);
        });

        await new Promise((resolve, reject) => {
          gunzip.on("end", resolve);
          gunzip.on("error", reject);
          gunzip.write(compressedBuffer);
          gunzip.end();
        });

        body = Buffer.concat(decompressed).toString("utf-8");
      } else {
        // Handle uncompressed response
        for await (const chunk of response.body) {
          body += chunk.toString();
        }
      }

      console.log(
        `[Response] Status: ${statusCode}, Body length: ${body.length}`
      );

      if (statusCode >= 400) {
        console.error(`[HTTP Error ${statusCode}]`);
        console.error("[Response Headers]", responseHeaders);
        console.error("[Response Body Preview]", body.substring(0, 1000));
        throw new Error(`HTTP ${statusCode}: ${body.substring(0, 200)}`);
      }

      return { body, headers: responseHeaders, statusCode };
    } catch (error: any) {
      console.error(`[Request Failed]`, error.message);
      throw error;
    }
  }

  /**
   * Login with email and password
   */
  async loginWithPassword(email?: string, password?: string): Promise<AuthResponse> {
    // If credentials not provided, try to load from storage first
    if (!email || !password) {
      const savedCredentials = this.context.globalState.get<{email: string; password: string}>('openjudge.credentials');

      if (savedCredentials) {
        console.log('[Login] Using saved credentials for:', savedCredentials.email);
        email = savedCredentials.email;
        password = savedCredentials.password;
      } else {
        // Ask user for credentials
        const inputEmail = await vscode.window.showInputBox({
          prompt: "请输入 OpenJudge 邮箱",
          placeHolder: "例如: your@email.com",
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return "邮箱不能为空";
            }
            if (!value.includes('@')) {
              return "请输入有效的邮箱地址";
            }
            return null;
          },
        });

        if (!inputEmail) {
          return {
            result: "ERROR",
            message: "用户取消登录",
          };
        }

        const inputPassword = await vscode.window.showInputBox({
          prompt: "请输入 OpenJudge 密码",
          placeHolder: "密码",
          password: true,
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return "密码不能为空";
            }
            return null;
          },
        });

        if (!inputPassword) {
          return {
            result: "ERROR",
            message: "用户取消登录",
          };
        }

        email = inputEmail.trim();
        password = inputPassword.trim();
      }
    }

    try {
      console.log('[Login] Attempting login for:', email);

      // Step 1: Get initial cookie by visiting the main page
      console.log('[Login] Step 1: Getting initial cookie from main page');
      await this.makeRequest('http://openjudge.cn/');

      // Step 2: Login with email and password
      console.log('[Login] Step 2: Logging in with email and password');
      const loginUrl = 'http://openjudge.cn/api/auth/login/';
      const redirectUrl = encodeURIComponent('http://openjudge.cn/');

      const loginBody = new URLSearchParams({
        redirectUrl,
        email,
        password,
      }).toString();

      const loginResponse = await this.makeRequest(loginUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'http://openjudge.cn',
          'Referer': 'http://openjudge.cn/auth/login/',
        },
        body: loginBody,
      });

      const loginResult = JSON.parse(loginResponse.body);
      console.log('[Login] Login API response:', loginResult);

      if (loginResult.result !== 'SUCCESS') {
        return {
          result: "ERROR",
          message: loginResult.message || "登录失败",
        };
      }

      // Step 3: Extract session info from cookies
      const phpSessId = this.cookieJar.get('PHPSESSID');
      const language = this.cookieJar.get('language') || 'zh_CN';

      if (!phpSessId) {
        return {
          result: "ERROR",
          message: "登录成功但未获取到会话 Cookie",
        };
      }

      // Save session
      this.session = {
        PHPSESSID: phpSessId,
        language: language as 'zh_CN' | 'en_US',
      };

      await this.context.globalState.update("openjudge.session", this.session);
      await this.context.globalState.update('openjudge.cookieJar', this.cookieJar.export());

      // Save credentials for auto-login
      await this.context.globalState.update('openjudge.credentials', {
        email,
        password,
      });

      console.log('[Login] Login successful, session saved');

      return {
        result: "SUCCESS",
        message: "登录成功",
        hint: loginResult.hint || "已保存登录凭据，下次将自动登录",
      };
    } catch (error: any) {
      console.error('[Login] Login failed:', error);
      return {
        result: "ERROR",
        message: `登录失败: ${error.message}`,
      };
    }
  }

  /**
   * Login with manual cookie input (legacy method)
   */
  async loginWithCookie(): Promise<AuthResponse> {
    // Step 1: Show instructions
    const proceed = await vscode.window.showInformationMessage(
      "请在浏览器中登录 OpenJudge，然后复制完整的 Cookie 字符串",
      {
        modal: true,
        detail:
          "1. 在浏览器中打开 http://openjudge.cn 并登录\n2. 按 F12 打开开发者工具\n3. 进入 Network 标签，刷新页面\n4. 选择任意请求，在 Headers 中找到 Cookie\n5. 复制完整的 Cookie 字符串（如：PHPSESSID=xxx; language=zh_CN）",
      },
      "继续",
      "取消"
    );

    if (proceed !== "继续") {
      return {
        result: "ERROR",
        message: "用户取消登录",
      };
    }

    // Step 2: Ask for complete cookie string
    const cookieString = await vscode.window.showInputBox({
      prompt: "请粘贴完整的 Cookie 字符串",
      placeHolder: "例如: PHPSESSID=abc123def456; language=zh_CN",
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "Cookie 不能为空";
        }
        if (!value.includes("PHPSESSID")) {
          return "Cookie 中必须包含 PHPSESSID";
        }
        return null;
      },
    });

    if (!cookieString) {
      return {
        result: "ERROR",
        message: "未输入 Cookie",
      };
    }

    // Parse cookie string
    const cookies = cookieString.split(";").map((c) => c.trim());
    let phpSessId = "";
    let languageValue: "zh_CN" | "en_US" = "zh_CN";

    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.split("=");
      const value = valueParts.join("="); // Handle values that contain '='

      if (name.trim() === "PHPSESSID") {
        phpSessId = value.trim();
      } else if (name.trim() === "language") {
        languageValue = value.trim() as "zh_CN" | "en_US";
      }
    }

    if (!phpSessId) {
      return {
        result: "ERROR",
        message: "Cookie 中未找到 PHPSESSID",
      };
    }

    // Get configured language from settings
    const config = vscode.workspace.getConfiguration("openjudge");
    const configuredLanguage = config.get<string>("interfaceLanguage");
    if (configuredLanguage) {
      languageValue = configuredLanguage as "zh_CN" | "en_US";
    }

    // Save session
    try {
      this.session = {
        PHPSESSID: phpSessId,
        language: languageValue,
      };

      // Initialize cookie jar with session
      this.cookieJar.clear(); // Clear existing cookies first
      this.cookieJar.set("PHPSESSID", phpSessId, "openjudge.cn");
      this.cookieJar.set("language", languageValue, "openjudge.cn");

      // Save to global state
      await this.context.globalState.update("openjudge.session", this.session);
      await this.context.globalState.update(
        "openjudge.cookieJar",
        this.cookieJar.export()
      );

      console.log(
        "Session saved successfully:",
        phpSessId.substring(0, 8) + "..."
      );

      // Verify the session by making a test request
      try {
        const response = await this.makeRequest(this.baseUrl + "/");

        if (response.statusCode === 200) {
          return {
            result: "SUCCESS",
            message: "登录成功",
            hint: "Cookie 已保存并验证",
          };
        } else {
          return {
            result: "SUCCESS",
            message: "登录成功",
            hint: "Cookie 已保存（验证状态未知）",
          };
        }
      } catch (error) {
        console.error("Failed to verify session:", error);
        return {
          result: "SUCCESS",
          message: "登录成功",
          hint: "Cookie 已保存（未验证）",
        };
      }
    } catch (error: any) {
      console.error("Failed to save session:", error);
      return {
        result: "ERROR",
        message: "保存 Cookie 失败: " + error.message,
      };
    }
  }

  /**
   * Login to OpenJudge using webview (deprecated - has CORS issues)
   */
  async loginWithWebview(): Promise<AuthResponse> {
    // Fallback to manual cookie input
    return this.loginWithCookie();
  }

  /**
   * Login to OpenJudge (legacy method, deprecated)
   */
  async login(): Promise<AuthResponse> {
    // This method is deprecated, use loginWithCookie instead
    return {
      result: "ERROR",
      message: "此登录方式已废弃，请使用 loginWithCookie 方法",
    };
  }

  /**
   * Fetch HTML content from a URL
   */
  async fetchHtml(url: string, subdomain?: string): Promise<string> {
    try {
      const targetUrl = subdomain
        ? url.replace("openjudge.cn", `${subdomain}.openjudge.cn`)
        : url;

      console.log("=== Fetching HTML ===");
      console.log("Target URL:", targetUrl);

      const response = await this.makeRequest(targetUrl, {
        method: "GET",
      });

      console.log("Successfully fetched HTML, length:", response.body.length);
      console.log(
        "Preview (first 500 chars):",
        response.body.substring(0, 500)
      );

      return response.body;
    } catch (error: any) {
      console.error("Failed to fetch HTML:", error.message);
      throw new Error(`Failed to fetch HTML: ${error.message}`);
    }
  }

  /**
   * Submit solution
   */
  async submitSolution(
    subdomain: string,
    data: SubmitRequest
  ): Promise<SubmitResponse> {
    try {
      const url = `http://${subdomain}.openjudge.cn/api/solution/submitv2/`;
      const refererUrl = `http://${subdomain}.openjudge.cn/${data.contestId}/${data.problemNumber}/submit/`;

      const body = new URLSearchParams({
        contestId: data.contestId,
        problemNumber: data.problemNumber,
        sourceEncode: data.sourceEncode,
        language: data.language,
        source: data.source,
      }).toString();

      console.log("=== Submitting Solution ===");
      console.log("URL:", url);
      console.log("Referer:", refererUrl);

      const response = await this.makeRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          Origin: `http://${subdomain}.openjudge.cn`,
          Referer: refererUrl,
        },
        body,
      });

      const result = JSON.parse(response.body);
      console.log("Submit result:", result);

      return result as SubmitResponse;
    } catch (error: any) {
      console.error("Submit failed:", error.message);
      return {
        result: "ERROR",
        message: error.message || "Submission failed",
      };
    }
  }

  /**
   * Switch language
   */
  async switchLanguage(
    language: "en_US" | "zh_CN",
    subdomain?: string
  ): Promise<void> {
    try {
      const url = subdomain
        ? `http://${subdomain}.openjudge.cn/api/language/switch/`
        : `${this.baseUrl}/api/language/switch/`;

      await this.makeRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({ language }).toString(),
      });

      // Update session language
      if (this.session) {
        this.session.language = language;
        this.cookieJar.set("language", language, "openjudge.cn");
        await this.context.globalState.update(
          "openjudge.session",
          this.session
        );
        await this.context.globalState.update(
          "openjudge.cookieJar",
          this.cookieJar.export()
        );
      }
    } catch (error) {
      console.error("Failed to switch language:", error);
    }
  }

  /**
   * Save session to VSCode global state (deprecated, session is saved directly now)
   */
  private async saveSession(): Promise<void> {
    // Session is now saved directly in loginWithCookie and switchLanguage
    // This method is kept for compatibility but does nothing
  }

  /**
   * Load session synchronously from VSCode global state
   */
  private loadSessionSync(): void {
    const savedSession =
      this.context.globalState.get<CookieSession>("openjudge.session");
    if (savedSession && savedSession.PHPSESSID) {
      this.session = savedSession;
      this.cookieJar.set("PHPSESSID", savedSession.PHPSESSID, "openjudge.cn");
      this.cookieJar.set("language", savedSession.language, "openjudge.cn");

      console.log(
        "Session loaded synchronously:",
        savedSession.PHPSESSID.substring(0, 8) + "..."
      );

      // Load cookie jar
      const savedCookieJar = this.context.globalState.get<Array<[string, any]>>(
        "openjudge.cookieJar"
      );
      if (savedCookieJar) {
        this.cookieJar.import(savedCookieJar);
        console.log("Cookie jar loaded, cookies:", savedCookieJar.length);
      }
    } else {
      console.log("No saved session found");
    }
  }

  /**
   * Load session from VSCode global state
   */
  private async loadSession(): Promise<void> {
    this.loadSessionSync();
  }

  /**
   * Clear session and credentials
   */
  async clearSession(): Promise<void> {
    this.session = null;
    this.cookieJar.clear();
    await this.context.globalState.update("openjudge.session", undefined);
    await this.context.globalState.update("openjudge.cookieJar", undefined);
    await this.context.globalState.update("openjudge.credentials", undefined);
    console.log('[Logout] Session and credentials cleared');
  }

  /**
   * Check if user is logged in
   */
  isLoggedIn(): boolean {
    return this.session !== null;
  }

  /**
   * Get current session
   */
  getSession(): CookieSession | null {
    return this.session;
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.agent.destroy();
  }
}
