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
        }

        .branch-transfer-smart > div {
          background: #f8fafc !important;
        }

        .branch-transfer-smart > div > div {
          max-width: 1440px !important;
          gap: 12px !important;
          padding-top: 14px !important;
          padding-bottom: 24px !important;
        }

        /* Compact command header: useful context without taking half the screen. */
        .branch-transfer-smart > div > div > div:first-child {
          border-radius: 20px !important;
          box-shadow: 0 8px 24px rgba(15, 118, 110, .10) !important;
        }

        .branch-transfer-smart > div > div > div:first-child > div {
          padding: 16px 18px !important;
        }

        .branch-transfer-smart > div > div > div:first-child h1 {
          font-size: 24px !important;
          line-height: 1.2 !important;
          margin-top: 4px !important;
        }

        .branch-transfer-smart > div > div > div:first-child p {
          margin-top: 5px !important;
          line-height: 1.55 !important;
        }

        /* File intake should feel like one clear action, not a large empty panel. */
        .branch-transfer-smart label[class*="min-h-40"] {
          min-height: 112px !important;
          border-radius: 18px !important;
          padding: 18px !important;
          background: linear-gradient(180deg, #f0fdfa 0%, #ffffff 100%) !important;
        }

        .branch-transfer-smart label[class*="min-h-40"] > div:first-child {
          padding: 9px !important;
          border-radius: 14px !important;
        }

        .branch-transfer-smart label[class*="min-h-40"] .text-lg {
          font-size: 16px !important;
          margin-top: 8px !important;
        }

        .branch-transfer-smart label[class*="min-h-40"] .max-w-2xl {
          font-size: 12px !important;
          line-height: 1.6 !important;
          margin-top: 2px !important;
        }

        /* Status cards: stronger hierarchy, less pastel noise. */
        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div {
          border-radius: 16px !important;
          min-height: 86px !important;
          box-shadow: 0 1px 2px rgba(15, 23, 42, .04) !important;
          background-image: none !important;
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(1) {
          border-color: #fecdd3 !important;
          background: #fff7f8 !important;
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(2) {
          border: 2px solid #f59e0b !important;
          background: #fffbeb !important;
          box-shadow: 0 7px 20px rgba(245, 158, 11, .10) !important;
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(2) > div:nth-child(2) {
          font-size: 30px !important;
          color: #b45309 !important;
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(3) {
          border-color: #bae6fd !important;
          background: #f7fcff !important;
        }

        .branch-transfer-smart .grid.grid-cols-2.gap-2.sm\\:grid-cols-4 > div:nth-child(4) {
          border-color: #bbf7d0 !important;
          background: #f7fff9 !important;
        }

        /* Navigation becomes a stable work switcher while scrolling. */
        .branch-transfer-smart .grid.grid-cols-3.gap-1.rounded-2xl {
          position: sticky !important;
          top: 8px !important;
          z-index: 30 !important;
          border-radius: 14px !important;
          background: rgba(248, 250, 252, .92) !important;
          backdrop-filter: blur(12px) !important;
          box-shadow: 0 6px 18px rgba(15, 23, 42, .06) !important;
        }

        .branch-transfer-smart .grid.grid-cols-3.gap-1.rounded-2xl button {
          border-radius: 10px !important;
          min-height: 40px !important;
        }

        /* Main decision card is the visual focus. */
        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 {
          border-radius: 20px !important;
          border-color: #cbd5e1 !important;
          box-shadow: 0 12px 32px rgba(15, 23, 42, .08) !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 > div[class*="border-b"] {
          padding: 16px 18px !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 > div.space-y-3 {
          padding: 16px 18px 18px !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 .md\\:grid-cols-\\[1fr_1fr_1\\.25fr\\] > div {
          border-radius: 14px !important;
        }

        .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 button {
          min-height: 40px !important;
          border-radius: 11px !important;
        }

        /* Advanced/manual controls should stay visually secondary. */
        .branch-transfer-smart button[class*="bg-slate-50"][class*="text-xs"] {
          opacity: .82;
        }

        /* Cleaner desktop density. */
        @media (min-width: 1024px) {
          .branch-transfer-smart > div > div {
            padding-left: 18px !important;
            padding-right: 18px !important;
          }

          .branch-transfer-smart .shadow-md.shadow-slate-900\\/5 {
            max-width: 1180px;
            margin-inline: auto;
          }
        }

        @media (max-width: 640px) {
          .branch-transfer-smart > div > div > div:first-child > div {
            padding: 14px !important;
          }

          .branch-transfer-smart > div > div > div:first-child h1 {
            font-size: 20px !important;
          }

          .branch-transfer-smart label[class*="min-h-40"] {
            min-height: 126px !important;
          }
        }
      `}</style>
    </div>
  );
}
