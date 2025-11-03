/**
 * Type definitions for OpenJudge extension
 */

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  result: 'SUCCESS' | 'ERROR';
  message: string;
  hint?: string;
  redirect?: string;
}

export interface Group {
  id: string;
  name: string;
  subdomain: string;
  description?: string;
}

export interface Practice {
  id: string;
  name: string;
  groupSubdomain: string;
  problemCount: number;
  url: string;
  type: 'practice' | 'contest';
}

export interface Problem {
  id: string;
  title: string;
  practiceId: string;
  groupSubdomain: string;
  acceptanceRate?: string;
  passedCount?: number;
  attemptCount?: number;
  url: string;
  contestId?: string;
}

export interface ProblemDetail {
  id: string;
  title: string;
  timeLimit: string;
  memoryLimit: string;
  description: string;
  input: string;
  output: string;
  sampleInput: string;
  sampleOutput: string;
  hint?: string;
  source?: string;
  globalId?: string;
}

export interface SubmitRequest {
  contestId: string;
  problemNumber: string;
  language: string;
  source: string;
  sourceEncode: 'base64';
}

export interface SubmitResponse {
  result: 'SUCCESS' | 'ERROR';
  message: string;
  redirect?: string;
}

export interface SubmissionStatus {
  id: string;
  problemId: string;
  status: 'Pending' | 'Running' | 'Accepted' | 'Wrong Answer' |
          'Time Limit Exceeded' | 'Memory Limit Exceeded' |
          'Runtime Error' | 'Compile Error' | 'Presentation Error';
  language: string;
  memory?: string;
  time?: string;
  submitTime: string;
  code?: string;
  errorMessage?: string;
}

export interface CookieSession {
  PHPSESSID: string;
  language: 'en_US' | 'zh_CN';
}

export interface UserConfig {
  groups: string[];
  preferredLanguage: string;
  interfaceLanguage: 'en_US' | 'zh_CN';
}
