import BranchTransferControl from './BranchTransferControl';

export default function BranchTransferControlSmart() {
  return (
    <div className="branch-transfer-smart">
      <BranchTransferControl />
      <style>{`
        .branch-transfer-smart {
          --bt-ink: #0f172a;
          --bt-muted: #64748b;
          --bt-teal: #0f766e;
          --bt-teal-soft: #f0fdfa;
          --bt-border: #e2e8f0;
          --bt-danger: #be123c;
          --bt-warning: #b45309;
          --bt-info: #0369a1;
          --bt-success: #047857;
        }

        .branch-transfer-smart > div {
          background: #f8fafc !important;
        }

        .branch-transfer-smart > div > div {
          max-width: 1480px !important;
          gap: 10px !important;
          padding-top: 12px !important;
          padding-bottom: 88px !important;
        }

        /* Compact command header */
        .branch-transfer-smart > div > div > div:first-child {
          border-radius: 18px !important;
          box-shadow: 0 7px 22px rgba(15, 118, 110, .10) !important;
        }

        .branch-transfer-smart > div > div > div:first-child > div {
          padding: 14px 17px !important;
        }

        .branch-transfer-smart > div > div > div:first-child h1 {
          font-size: 23px !important;
          line-height: 1.2 !important;
          margin-top: 3px !important;
        }

        .branch-transfer-smart > div > div > div:first-child p {
          margin-top: 4px !important;
          line-height: 1.5 !important;
          font-size: 12px !important;
        }

        /* File intake: one clear action before upload */
        .branch-transfer-smart label[class*="min-h-40"] {
          min-height: 104px !important;
          border-radius: 17px !important;
          padding: 15px !important;
          background: linear-gradient(180deg, #f0fdfa 0%, #ffffff 100%) !important;
        }

        .branch-transfer-smart label[class*="min-h-40"] > div:first-child {
          padding: 8px !important;
          border-radius: 13px !important;
        }

        .branch-transfer-smart label[class*="min-h-40"] .text-lg {
          font-size: 16px !important;
          margin-top: 7px !important;
        }

        .branch-transfer-smart label[class*="min-h-40"] .max-w-2xl {
          font-size: 11px !important;
          line-height: 1.55 !important;
          margin-top: 1px !important;
        }

        /* Once files are classified, the upload area becomes a compact utility strip. */
        .branch-transfer-smart div:has(> label[class*="min-h-40"]):has(.bg-emerald-50\/60) > label[class*="min-h-40"] {
          min-height: 66px !important;
          flex-direction: row !important;
          justify-content: flex-start !important;
          text-align: right !important;
          gap: 10px !important;
          padding: 10px 13px !important;
          border-style: solid !important;
          border-width: 1px !important;
        }

        .branch-transfer-smart div:has(> label[class*="min-h-40"]):has(.bg-emerald-50\/60) > label[class*="min-h-40"] > div:first-child {
          padding: 7px !important;
          flex: 0 0 auto;
        }

        .branch-transfer-smart div:has(> label[class*="min-h-40"]):has(.bg-emerald-50\/60) > label[class*="min-h-40"] .max-w-2xl {
          display: none !important;
        }

        .branch-transfer-smart div:has(> label[class*="min-h-40"]):has(.bg-emerald-50\/60) > label[class*="min-h-40"] .text-lg {
          margin: 0 !important;
          font-size: 14px !important;
        }

        .branch-transfer-smart div:has(> label[class*="min-h-40"]):has(.bg-emerald-50\/60) > label[class*="min-h-40"] > div:last-of-type {
          margin: 0 6px 0 0 !important;
          padding: 7px 11px !important;
        }

        /* Auto-classification summary: compact, scannable, not another dashboard. */
        .branch-transfer-smart div:has(> label[class*="min-h-40"]) .grid.sm\\:grid-cols-2.lg\\:grid-cols-4 > div {
          padding: 9px 11px !important;
          border-radius: 13px !important;
          min-height: 62px !important;
        }

        .branch-transfer-smart div:has(> label[class*="min-h-40"]) .grid.sm\\:grid-cols-2.lg\\:grid-cols-4 .text-xl {
          font-size: 17px !important;
          margin-top: 2px !important;
        }

        /* Status cards: only the action signal is loud. */
        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div {
          border-radius: 15px !important;
          min-height: 78px !important;
          padding: 11px 13px !important;
          box-shadow: 0 1px 2px rgba(15, 23, 42, .04) !important;
          background-image: none !important;
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(1) {
          border-color: #fecdd3 !important;
          background: #fffafa !important;
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(2) {
          border: 2px solid #f59e0b !important;
          background: #fffbeb !important;
          box-shadow: 0 7px 18px rgba(245, 158, 11, .11) !important;
          transform: translateY(-1px);
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(2) > div:nth-child(2) {
          font-size: 28px !important;
          line-height: 1 !important;
          color: var(--bt-warning) !important;
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(3) {
          border-color: #bae6fd !important;
          background: #f8fdff !important;
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(4) {
          border-color: #bbf7d0 !important;
          background: #fbfffc !important;
        }

        /* Sticky work switcher */
        .branch-transfer-smart .grid.grid-cols-3.gap-1.rounded-2xl {
          position: sticky !important;
          top: 7px !important;
          z-index: 30 !important;
          border-radius: 13px !important;
          background: rgba(248, 250, 252, .94) !important;
          backdrop-filter: blur(14px) !important;
          box-shadow: 0 5px 16px rgba(15, 23, 42, .07) !important;
          padding: 4px !important;
        }

        .branch-transfer-smart .grid.grid-cols-3.gap-1.rounded-2xl button {
          border-radius: 9px !important;
          min-height: 38px !important;
        }

        /* Main decision card: looks and behaves like one focused work item. */
        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 {
          border-radius: 19px !important;
          border-color: #cbd5e1 !important;
          box-shadow: 0 12px 30px rgba(15, 23, 42, .075) !important;
          overflow: visible !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 > div[class*="border-b"] {
          padding: 14px 17px !important;
          border-radius: 17px 17px 0 0 !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 > div.space-y-3 {
          padding: 14px 17px 16px !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .md\\:grid-cols-\\[1fr_1fr_1\\.25fr\\] {
          gap: 9px !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .md\\:grid-cols-\\[1fr_1fr_1\\.25fr\\] > div {
          border-radius: 13px !important;
          padding: 12px !important;
        }

        /* The recommendation is the main visual instruction. */
        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .md\\:grid-cols-\\[1fr_1fr_1\\.25fr\\] > div:nth-child(3) {
          border-width: 2px !important;
          border-color: #5eead4 !important;
          background: linear-gradient(145deg, #f0fdfa 0%, #ecfeff 100%) !important;
          box-shadow: inset 0 0 0 1px rgba(13, 148, 136, .04) !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .md\\:grid-cols-\\[1fr_1fr_1\\.25fr\\] > div:nth-child(3) .text-sm {
          font-size: 14px !important;
          line-height: 1.75 !important;
        }

        /* Decision actions stay available while reading long diagnostics. */
        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .flex.flex-wrap.gap-2.rounded-2xl.border.border-slate-100 {
          position: sticky !important;
          bottom: 8px !important;
          z-index: 22 !important;
          border-color: #cbd5e1 !important;
          background: rgba(255, 255, 255, .96) !important;
          backdrop-filter: blur(12px) !important;
          box-shadow: 0 9px 26px rgba(15, 23, 42, .11) !important;
          border-radius: 14px !important;
          padding: 9px !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 button {
          min-height: 38px !important;
          border-radius: 10px !important;
          padding-inline: 14px !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .flex.flex-wrap.gap-2.rounded-2xl.border.border-slate-100 button:first-child {
          min-width: 150px;
          box-shadow: 0 4px 12px rgba(15, 118, 110, .15);
        }

        /* Identity diagnosis remains visible but visually subordinate to the recommended action. */
        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .rounded-2xl.border.p-3\\.5 {
          border-radius: 13px !important;
          padding: 11px !important;
          box-shadow: none !important;
        }

        /* Advanced/manual controls stay secondary. */
        .branch-transfer-smart button[class*="bg-slate-50"][class*="text-xs"] {
          opacity: .76;
          min-height: 34px !important;
        }

        .branch-transfer-smart button[class*="bg-slate-50"][class*="text-xs"]:hover {
          opacity: 1;
        }

        /* Empty / success states should be calm. */
        .branch-transfer-smart .min-h-64,
        .branch-transfer-smart .min-h-56 {
          min-height: 190px !important;
          border-radius: 18px !important;
        }

        @media (min-width: 1024px) {
          .branch-transfer-smart > div > div {
            padding-left: 16px !important;
            padding-right: 16px !important;
          }

          .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 {
            max-width: 1220px;
            margin-inline: auto;
          }
        }

        @media (max-width: 640px) {
          .branch-transfer-smart > div > div {
            padding-bottom: 96px !important;
          }

          .branch-transfer-smart > div > div > div:first-child > div {
            padding: 12px !important;
          }

          .branch-transfer-smart > div > div > div:first-child h1 {
            font-size: 19px !important;
          }

          .branch-transfer-smart label[class*="min-h-40"] {
            min-height: 118px !important;
          }

          .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .flex.flex-wrap.gap-2.rounded-2xl.border.border-slate-100 {
            bottom: 6px !important;
          }

          .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .flex.flex-wrap.gap-2.rounded-2xl.border.border-slate-100 button {
            flex: 1 1 calc(50% - 4px);
          }
        }
      `}</style>
    </div>
  );
}
