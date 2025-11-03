import * as cheerio from 'cheerio';
import { Practice, Problem, ProblemDetail } from './types';

export class HtmlParser {
  /**
   * Parse group home page to extract practices/contests
   */
  static parsePracticeList(html: string, subdomain: string): Practice[] {
    const $ = cheerio.load(html);
    const practices: Practice[] = [];

    console.log('[HtmlParser] Parsing practice list for subdomain:', subdomain);

    // Parse practice items
    $('li.practice-info').each((_, element) => {
      const $elem = $(element);
      const link = $elem.find('h3 a').first();
      const href = link.attr('href');
      const name = link.text().trim();

      // More flexible regex to match practice ID
      const match = href?.match(/\/([^/]+)\/$/);

      if (match && href) {
        const practiceId = match[1];
        const problemCountText = link.parent().text();
        const countMatch = problemCountText.match(/\((\d+)题\)/);
        const problemCount = countMatch ? parseInt(countMatch[1]) : 0;

        console.log(`[HtmlParser] Found practice: ${name} (${practiceId}) - ${problemCount} problems`);

        practices.push({
          id: practiceId,
          name: name,
          groupSubdomain: subdomain,
          problemCount,
          url: `http://${subdomain}.openjudge.cn/${practiceId}/`,
          type: 'practice'
        });
      } else {
        console.warn(`[HtmlParser] Failed to parse practice href:`, href, 'name:', name);
      }
    });

    // Parse contest items
    $('li.contest-info').each((_, element) => {
      const $elem = $(element);
      const link = $elem.find('h3 a').first();
      const href = link.attr('href');
      const name = link.text().trim();

      // More flexible regex to match contest ID
      const match = href?.match(/\/([^/]+)\/$/);

      if (match && href) {
        const contestId = match[1];
        const problemCountText = link.parent().text();
        const countMatch = problemCountText.match(/\((\d+)题\)/);
        const problemCount = countMatch ? parseInt(countMatch[1]) : 0;

        console.log(`[HtmlParser] Found contest: ${name} (${contestId}) - ${problemCount} problems`);

        practices.push({
          id: contestId,
          name: name,
          groupSubdomain: subdomain,
          problemCount,
          url: `http://${subdomain}.openjudge.cn/${contestId}/`,
          type: 'contest'
        });
      } else {
        console.warn(`[HtmlParser] Failed to parse contest href:`, href, 'name:', name);
      }
    });

    console.log(`[HtmlParser] Total practices/contests found: ${practices.length}`);
    return practices;
  }

  /**
   * Parse practice page to extract problem list
   */
  static parseProblemList(html: string, practiceId: string, subdomain: string): Problem[] {
    const $ = cheerio.load(html);
    const problems: Problem[] = [];

    console.log(`[HtmlParser] Parsing problem list for practice: ${practiceId}`);

    // Extract contestId from form (may not exist on all pages)
    const contestIdInput = $('input[name="contestId"]');
    const contestId = contestIdInput.val() as string;

    console.log(`[HtmlParser] Found contestId input: ${contestIdInput.length} elements`);
    console.log(`[HtmlParser] Contest ID: ${contestId || '(not found)'}`);

    // Parse problem table - support two different table structures
    const tables = $('table');
    console.log(`[HtmlParser] Found ${tables.length} table(s) in the page`);

    // Try structure 1: table with td.problem-id and td.title (contest/practice page)
    let foundProblems = false;
    $('table tbody tr').each((index, element) => {
      const $row = $(element);

      // Check if this row uses the contest/practice structure
      const $problemIdCell = $row.find('td.problem-id');
      const $titleCell = $row.find('td.title');

      if ($problemIdCell.length > 0 && $titleCell.length > 0) {
        foundProblems = true;
        const problemId = $problemIdCell.find('a').text().trim();
        const problemTitle = $titleCell.find('a').text().trim();
        const $submissionsCell = $row.find('td.submissions');
        const attemptCount = $submissionsCell.length > 0
          ? parseInt($submissionsCell.find('a').text().trim())
          : undefined;

        if (problemId && problemTitle) {
          console.log(`[HtmlParser]   Problem: ${problemId} - ${problemTitle}`);

          problems.push({
            id: problemId,
            title: problemTitle,
            practiceId,
            groupSubdomain: subdomain,
            acceptanceRate: undefined,
            passedCount: undefined,
            attemptCount,
            url: `http://${subdomain}.openjudge.cn/${practiceId}/${problemId}/`,
            contestId
          });
        }
      }
    });

    // Try structure 2: table with generic td cells (older structure)
    if (!foundProblems) {
      console.log(`[HtmlParser] Trying alternate table structure...`);

      $('table tbody tr').each((index, element) => {
        const $row = $(element);
        const $cells = $row.find('td');

        console.log(`[HtmlParser] Row ${index + 1}: ${$cells.length} cells`);

        if ($cells.length >= 2) {
          const problemId = $cells.eq(0).find('a').text().trim();
          const problemTitle = $cells.eq(1).find('a').text().trim();
          const acceptanceRate = $cells.length > 2 ? $cells.eq(2).find('a').text().trim() : undefined;
          const passedCount = $cells.length > 3 ? parseInt($cells.eq(3).find('a').text().trim()) : undefined;
          const attemptCount = $cells.length > 4 ? parseInt($cells.eq(4).find('a').text().trim()) : undefined;

          if (problemId && problemTitle) {
            console.log(`[HtmlParser]   Problem: ${problemId} - ${problemTitle}`);

            problems.push({
              id: problemId,
              title: problemTitle,
              practiceId,
              groupSubdomain: subdomain,
              acceptanceRate,
              passedCount,
              attemptCount,
              url: `http://${subdomain}.openjudge.cn/${practiceId}/${problemId}/`,
              contestId
            });
          } else {
            console.warn(`[HtmlParser]   Skipping row - missing ID or title`);
          }
        }
      });
    }

    console.log(`[HtmlParser] Total problems found: ${problems.length}`);
    return problems;
  }

  /**
   * Parse problem detail page
   */
  static parseProblemDetail(html: string, problemId: string): ProblemDetail {
    const $ = cheerio.load(html);

    const title = $('#pageTitle h2').text().replace(/^\d+:/, '').trim();

    const params: Record<string, string> = {};
    $('dl.problem-params dt').each((i, dt) => {
      const key = $(dt).text().trim().replace(':', '');
      const value = $(dt).next('dd').text().trim();
      params[key] = value;
    });

    const content: Record<string, string> = {};
    $('dl.problem-content dt').each((i, dt) => {
      const key = $(dt).text().trim();
      const $dd = $(dt).next('dd');

      // Handle pre tags specially
      const $pre = $dd.find('pre');
      if ($pre.length > 0) {
        content[key] = $pre.html() || $pre.text();
      } else {
        content[key] = $dd.html() || $dd.text();
      }
    });

    const globalId = $('.problem-statistics dl dd').first().text().trim();

    return {
      id: problemId,
      title,
      timeLimit: params['总时间限制'] || params['Time Limit'] || 'N/A',
      memoryLimit: params['内存限制'] || params['Memory Limit'] || 'N/A',
      description: content['描述'] || content['Description'] || '',
      input: content['输入'] || content['Input'] || '',
      output: content['输出'] || content['Output'] || '',
      sampleInput: content['样例输入'] || content['Sample Input'] || '',
      sampleOutput: content['样例输出'] || content['Sample Output'] || '',
      hint: content['提示'] || content['Hint'],
      source: content['来源'] || content['Source'],
      globalId
    };
  }

  /**
   * Parse submission status page
   */
  static parseSubmissionStatus(html: string, submissionId: string) {
    const $ = cheerio.load(html);

    console.log('[HtmlParser] Parsing submission status for:', submissionId);

    // Extract status from compile-status section
    const statusElement = $('.compile-status a, .compile-status span.result-right, .compile-status span.result-wrong');
    const status = statusElement.text().trim();

    console.log('[HtmlParser] Status element found:', statusElement.length);
    console.log('[HtmlParser] Status text:', status);

    // Extract info from compile-info section
    const info: Record<string, string> = {};
    $('.compile-info dl dt').each((i, dt) => {
      const key = $(dt).text().trim().replace(':', '');
      const value = $(dt).next('dd').text().trim();
      if (key && value) {
        info[key] = value;
        console.log(`[HtmlParser] Info: ${key} = ${value}`);
      }
    });

    // Extract source code
    const code = $('pre.sh_python, pre.sh_cpp, pre.sh_c, pre.sh_java, pre').first().text();
    console.log('[HtmlParser] Code length:', code.length);

    // Extract error message if compile error
    let errorMessage = '';
    if (status.includes('Compile Error') || status.includes('编译错误')) {
      const errorPre = $('pre').filter((i, el) => {
        const text = $(el).text();
        return text.includes('error') || text.includes('Error') || text.includes('错误');
      });
      if (errorPre.length > 0) {
        errorMessage = errorPre.first().text();
      }
    }

    const result = {
      id: submissionId,
      problemId: info['题目'] || info['Problem'] || info['问题'] || '',
      status: status as any,
      language: info['语言'] || info['Language'] || '',
      memory: info['内存'] || info['Memory'] || undefined,
      time: info['时间'] || info['Time'] || undefined,
      submitTime: info['提交时间'] || info['Submit Time'] || '',
      submitter: info['提交人'] || info['Submitter'] || undefined,
      code,
      errorMessage
    };

    console.log('[HtmlParser] Parsed submission:', {
      id: result.id,
      status: result.status,
      problemId: result.problemId,
      hasCode: !!result.code,
      hasError: !!result.errorMessage
    });

    return result;
  }

  /**
   * Extract contest ID from problem page
   */
  static extractContestId(html: string): string | undefined {
    const $ = cheerio.load(html);
    const contestIdInput = $('input[name="contestId"]');
    const contestId = contestIdInput.val() as string | undefined;

    console.log('Extracting contestId from HTML...');
    console.log('Found input[name="contestId"] elements:', contestIdInput.length);
    console.log('Extracted contestId:', contestId);

    if (contestIdInput.length > 0) {
      console.log('Input element HTML:', contestIdInput.toString());
    } else {
      console.warn('No input[name="contestId"] found in HTML');
      console.log('HTML preview (first 1000 chars):', html.substring(0, 1000));
    }

    return contestId;
  }
}
