import { describe, expect, it } from 'vitest';
import { buildDecisionCompression, decisionPatternPeers, sameDecisionPattern } from '../src/lib/branchTransferDecisionCompression.js';

describe('branch transfer decision compression', () => {
  it('summarizes a missing counterpart in one decision line', () => {
    const incident = { kind: 'single_missing', triage: { confidence: 91, repeat_count: 3, impact_count: 3 } };
    const item = { sale_qty: 2, sale_lines: [{ id: 1 }], purchase_qty: 0, purchase_lines: [] };
    const result = buildDecisionCompression(incident, item);
    expect(result.fact).toContain('البيع موجود');
    expect(result.risk).toBe('طرف مقابل غير موجود');
    expect(result.impact_count).toBe(3);
    expect(result.one_line).toContain('طرف مقابل غير موجود');
  });

  it('does not mark mixed units as a fast decision', () => {
    const incident = { kind: 'quantity_mismatch', triage: { confidence: 98, quick: true } };
    const item = { sale_qty: 10, purchase_qty: 1, mixed_units_detected: true };
    const result = buildDecisionCompression(incident, item);
    expect(result.risk).toBe('وحدات مختلفة');
    expect(result.can_fast_decide).toBe(false);
  });

  it('surfaces trusted packaging and consistent history as evidence', () => {
    const incident = { triage: { confidence: 94, repeat_count: 4, previous_decision_count: 3, previous_consistent: true } };
    const item = {
      sale_qty: 3,
      purchase_qty: 1,
      packaging_profile: { confidence: 'confirmed', label: '1 علبة = 3 شرائط' },
      remaining_qty_display: { precise: true, primary: '0 علبة' },
    };
    const result = buildDecisionCompression(incident, item);
    expect(result.evidence).toContain('عبوة موثوقة: 1 علبة = 3 شرائط');
    expect(result.evidence.some((entry) => entry.includes('قرار تاريخي متسق'))).toBe(true);
  });

  it('finds only peers with the same decision identity', () => {
    const selected = { id: 'a', triage: { identity: 'code:10::quantity' } };
    const peers = [selected, { id: 'b', triage: { identity: 'code:10::quantity' } }, { id: 'c', triage: { identity: 'code:10::code' } }];
    expect(sameDecisionPattern(selected, peers[1])).toBe(true);
    expect(decisionPatternPeers(peers, selected).map((entry) => entry.id)).toEqual(['b']);
  });
});
