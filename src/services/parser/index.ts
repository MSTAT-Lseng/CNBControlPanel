/**
 * Usage Parser Service.
 * Resolves organization quota usage for AI Credits, Cloud Native Build CPU,
 * and Cloud Native Dev CPU given a username and cookie.
 * Currently returns realistic randomized mock data while preserving the full service contract.
 */

import type { LogReporter, ParserInput, ParserPort, ServiceResult, UsageSnapshot } from '@/contracts';
import { generateMockUsageSnapshot } from './mockGenerator';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizePackageCount(snapshot: UsageSnapshot): number {
  return (
    snapshot.aiCredits.packages.length +
    snapshot.buildCpu.packages.length +
    snapshot.devCpu.packages.length
  );
}

/**
 * Creates a ParserPort instance bound to an injected LogReporter.
 */
export function createParserService(logger: LogReporter): ParserPort {
  return {
    async parseUsage(input: ParserInput): Promise<ServiceResult<UsageSnapshot>> {
      const username = input.username.trim();
      const cookie = input.cookie.trim();

      if (!username || !cookie) {
        logger.warn(
          'parser.parseUsage',
          'Rejected usage parse due to missing credentials',
          `hasUsername=${Boolean(username)} hasCookie=${Boolean(cookie)}`,
        );
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Username and cookie are required to parse usage',
          },
          timestamp: Date.now(),
        };
      }

      logger.verbose(
        'parser.parseUsage',
        `Starting mock quota parsing for "${username}"`,
        `cookieLength=${cookie.length}`,
      );

      try {
        // Simulate realistic network latency during mock phase.
        const simulatedLatencyMs = 220 + Math.floor(Math.random() * 280);
        await delay(simulatedLatencyMs);

        const snapshot = generateMockUsageSnapshot(username);
        const totalPackages = summarizePackageCount(snapshot);

        logger.info(
          'parser.parseUsage',
          `Parsed mock usage snapshot for "${username}" (${totalPackages} packages)`,
          `latencyMs=${simulatedLatencyMs}`,
        );

        return {
          ok: true,
          data: snapshot,
          timestamp: Date.now(),
        };
      } catch (err) {
        logger.error('parser.parseUsage', `Failed to parse usage for "${username}"`, String(err));
        return {
          ok: false,
          error: {
            code: 'PARSER_ERROR',
            message: `Failed to parse quota data for "${username}"`,
            cause: err instanceof Error ? err.message : String(err),
          },
          timestamp: Date.now(),
        };
      }
    },
  };
}
