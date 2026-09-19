import { captureApiCall, type CaptureOptions, type EvidenceResult } from './evidence-capture';
import { StudyDefinitionClient } from './study-definition-client';

/** One qualification result includes all exact command/readback exchanges.
 * A rejected command, malformed success or mismatched readback fails the step. */
export async function captureStudyOperation<T>(
  testCaseId: string,
  baseUrl: string,
  token: string,
  description: string,
  operation: (client: StudyDefinitionClient) => Promise<T>,
  capture: (options: CaptureOptions) => Promise<EvidenceResult> = captureApiCall,
): Promise<{ evidence: EvidenceResult; value?: T }> {
  const exchanges: EvidenceResult[] = [];
  const client = new StudyDefinitionClient(async (method, path, body) => {
    const exchange = await capture({
      testCaseId: `${testCaseId}-${exchanges.length + 1}`, baseUrl,
      method, url: `/api${path}`, body, headers: { Authorization: `Bearer ${token}` },
    });
    // captureApiCall must receive the real credentials, evidence must not retain them.
    exchange.requestHeaders = { ...exchange.requestHeaders, Authorization: '[redacted]' };
    if (exchange.requestBody && typeof exchange.requestBody === 'object') {
      const safeBody = structuredClone(exchange.requestBody) as Record<string, any>;
      if (safeBody.signature) safeBody.signature.password = '[redacted]';
      for (const key of ['password', 'signaturePassword']) if (key in safeBody) safeBody[key] = '[redacted]';
      exchange.requestBody = safeBody;
    }
    exchanges.push(exchange);
    return { status: exchange.responseStatus, body: exchange.responseBody };
  });
  const result = (passed: boolean, notes: string): EvidenceResult => ({
    ...(exchanges[0] ?? {
      timestamp: new Date().toISOString(), method: 'CONTRACT', endpoint: '/api/studies',
      responseStatus: 0, responseBody: null,
    }),
    testCaseId, passed, notes, relatedEvidence: exchanges,
  });
  try {
    const value = await operation(client);
    return { value, evidence: result(true, `${description}; all ${exchanges.length} command/readback exchanges verified.`) };
  } catch (error) {
    return { evidence: result(false, `${description} failed: ${error instanceof Error ? error.message : 'Study contract failed.'}`) };
  }
}
