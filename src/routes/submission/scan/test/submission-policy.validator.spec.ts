import {
  SubmissionFindingCode,
  SubmissionFindingSeverity,
} from '../../../../shared/constants/submission.constant.ts';
import {
  buildEmbeddedCredentialFindings,
  findUnsupportedAssets,
} from '../scanner/submission-policy.validator.ts';

function graph(node: Record<string, unknown>) {
  return { nodes: [{ id: 'n1', type: 'utility.log', bindings: {}, ...node }] };
}

function rulesFor(node: Record<string, unknown>): string[] {
  return buildEmbeddedCredentialFindings(graph(node)).map(
    (finding) => finding.details?.['rule'] as string,
  );
}

function severityFor(node: Record<string, unknown>): string[] {
  return buildEmbeddedCredentialFindings(graph(node)).map((finding) => finding.severity);
}

describe('buildEmbeddedCredentialFindings', () => {
  it('finds a PEM private key block in node config', () => {
    expect(rulesFor({ config: { message: '-----BEGIN RSA PRIVATE KEY-----\nMIIB' } })).toEqual([
      'PEM_PRIVATE_KEY',
    ]);
  });

  it('finds a JWT by its three base64url segments', () => {
    expect(
      rulesFor({
        config: { message: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP' },
      }),
    ).toEqual(['JWT']);
  });

  it('finds a bearer token and a signed URL parameter', () => {
    expect(rulesFor({ config: { message: 'Bearer abcdefghijklmnopqrstuvwxyz0123' } })).toEqual([
      'BEARER_TOKEN',
    ]);
    expect(
      rulesFor({ config: { url: 'https://r2.example.com/o?X-Amz-Signature=deadbeef' } }),
    ).toEqual(['SIGNED_URL_PARAMETER']);
  });

  it('reads nested config objects and arrays', () => {
    expect(
      rulesFor({ config: { headers: [{ value: 'Bearer abcdefghijklmnopqrstuvwxyz0123' }] } }),
    ).toEqual(['BEARER_TOKEN']);
  });

  it('reads the value of a literal binding', () => {
    expect(
      buildEmbeddedCredentialFindings(
        graph({
          config: {},
          bindings: { message: { kind: 'LITERAL', value: '-----BEGIN PRIVATE KEY-----' } },
        }),
      ).map((finding) => finding.details?.['path']),
    ).toEqual(['bindings.message.value']);
  });

  it('ignores binding kinds that only reference something by name', () => {
    expect(
      rulesFor({
        config: {},
        bindings: { message: { kind: 'WORKFLOW_INPUT', inputName: 'Bearer' } },
      }),
    ).toEqual([]);
  });

  // The point of a fixed pattern set rather than an entropy heuristic.
  it.each([
    'a perfectly ordinary log message',
    'https://example.com/page?id=12345&page=2',
    'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5',
    'bearer',
    'package com.example.app',
  ])('does not flag ordinary content: %s', (message) => {
    expect(rulesFor({ config: { message } })).toEqual([]);
  });

  it('fails the scan only for the shapes that cannot be anything else', () => {
    expect(severityFor({ config: { message: '-----BEGIN PRIVATE KEY-----' } })).toEqual([
      SubmissionFindingSeverity.ERROR,
    ]);
    expect(
      severityFor({
        config: { message: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP' },
      }),
    ).toEqual([SubmissionFindingSeverity.ERROR]);
    expect(severityFor({ config: { message: 'Bearer abcdefghijklmnopqrstuvwxyz0123' } })).toEqual([
      SubmissionFindingSeverity.WARNING,
    ]);
    expect(
      severityFor({ config: { url: 'https://r2.example.com/o?X-Amz-Signature=deadbeef' } }),
    ).toEqual([SubmissionFindingSeverity.WARNING]);
  });

  it('names the rule and the path but never the matched text', () => {
    const [finding] = buildEmbeddedCredentialFindings(
      graph({ config: { nested: { secret: '-----BEGIN PRIVATE KEY-----' } } }),
    );

    expect(finding?.code).toBe(SubmissionFindingCode.EMBEDDED_CREDENTIAL);
    expect(finding?.nodeId).toBe('n1');
    expect(finding?.details).toEqual({ rule: 'PEM_PRIVATE_KEY', path: 'config.nested.secret' });
    expect(JSON.stringify(finding)).not.toContain('BEGIN PRIVATE KEY');
  });

  it('caps findings so one pasted key cannot grow the scan result', () => {
    const config = Object.fromEntries(
      Array.from({ length: 25 }, (_, at) => [`field${at}`, '-----BEGIN PRIVATE KEY-----']),
    );

    expect(buildEmbeddedCredentialFindings(graph({ config }))).toHaveLength(10);
  });

  it('tolerates a malformed graph instead of throwing', () => {
    expect(buildEmbeddedCredentialFindings({})).toEqual([]);
    expect(buildEmbeddedCredentialFindings({ nodes: 'not-an-array' })).toEqual([]);
    expect(buildEmbeddedCredentialFindings({ nodes: [null, 'x', { id: 'n1' }] })).toEqual([]);
  });

  describe('findUnsupportedAssets', () => {
    it('accepts a graph with no asset key and one with an empty list', () => {
      expect(findUnsupportedAssets({ nodes: [] })).toEqual([]);
      expect(findUnsupportedAssets({ nodes: [], assets: [] })).toEqual([]);
    });

    it('reports an asset-bearing graph with a bounded count', () => {
      const [finding] = findUnsupportedAssets({
        nodes: [],
        assets: [{ alias: 'private-input' }, { alias: 'other' }],
      });

      expect(finding?.code).toBe(SubmissionFindingCode.ASSET_UNSUPPORTED);
      expect(finding?.details).toEqual({ count: 2 });
      expect(JSON.stringify(finding)).not.toContain('private-input');
    });
  });
});
