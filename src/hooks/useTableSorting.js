import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { sortArray, isFieldAllowed } from "@/lib/sortUtils";

/**
 * Hook موحد للترتيب مع مزامنة URL.
 *
 * @param {object} opts
 * @param {Array} opts.columns - [{ field, label, type, statusMap?, getValue? }]
 * @param {object} opts.defaultSort - { field, direction }
 * @param {string} opts.paramPrefix - بادئة لمعاملات URL (لتجنب التعارض بين عدة جداول)
 * @param {boolean} opts.persist - حفظ في Local Storage كاحتياط
 *
 * @returns { sortField, sortDirection, toggleSort, setSort, resetSort, sortData, isActive, activeColumn, allowedFields }
 */
export function useTableSorting({ columns, defaultSort = {}, paramPrefix = "", persist = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sortKey = paramPrefix ? `${paramPrefix}_sort` : "sort";
  const dirKey = paramPrefix ? `${paramPrefix}_dir` : "dir";

  const allowedFields = useMemo(() => columns.map((c) => c.field), [columns]);
  const colMap = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.field, c])),
    [columns]
  );

  const storageKey = paramPrefix ? `sort:${paramPrefix}` : "sort:default";

  const readInitial = () => {
    const urlField = searchParams.get(sortKey);
    const urlDir = searchParams.get(dirKey);
    if (urlField && isFieldAllowed(urlField, allowedFields) && (urlDir === "asc" || urlDir === "desc")) {
      return { field: urlField, direction: urlDir };
    }
    if (persist) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.field && isFieldAllowed(parsed.field, allowedFields)) {
            return { field: parsed.field, direction: parsed.direction || "asc" };
          }
        }
      } catch {}
    }
    return { field: defaultSort.field, direction: defaultSort.direction };
  };

  const initial = readInitial();
  const sortField = initial.field;
  const sortDirection = initial.direction;

  const updateUrl = useCallback(
    (field, direction) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!field || !direction) {
            next.delete(sortKey);
            next.delete(dirKey);
          } else {
            next.set(sortKey, field);
            next.set(dirKey, direction);
          }
          return next;
        },
        { replace: true }
      );
      if (persist) {
        try {
          if (field && direction) {
            localStorage.setItem(storageKey, JSON.stringify({ field, direction }));
          } else {
            localStorage.removeItem(storageKey);
          }
        } catch {}
      }
    },
    [setSearchParams, sortKey, dirKey, storageKey, persist]
  );

  const toggleSort = useCallback(
    (field) => {
      if (!isFieldAllowed(field, allowedFields)) return;
      let nextField = field;
      let nextDir;
      if (sortField === field) {
        if (sortDirection === "asc") nextDir = "desc";
        else if (sortDirection === "desc") {
          nextField = null;
          nextDir = null;
        } else nextDir = "asc";
      } else {
        nextDir = "asc";
      }
      updateUrl(nextField, nextDir);
    },
    [sortField, sortDirection, allowedFields, updateUrl]
  );

  const setSort = useCallback(
    (field, direction) => {
      if (field && !isFieldAllowed(field, allowedFields)) return;
      updateUrl(field, direction);
    },
    [allowedFields, updateUrl]
  );

  const resetSort = useCallback(() => updateUrl(null, null), [updateUrl]);

  const sortData = useCallback(
    (data) => {
      if (!sortField || !sortDirection || !isFieldAllowed(sortField, allowedFields)) {
        return data;
      }
      const col = colMap[sortField];
      if (!col) return data;
      return sortArray(data, sortField, sortDirection, col.type, col.statusMap, col.getValue);
    },
    [sortField, sortDirection, allowedFields, colMap]
  );

  const isActive = !!sortField && !!sortDirection;
  const activeColumn = isActive ? colMap[sortField] : null;

  return { sortField, sortDirection, toggleSort, setSort, resetSort, sortData, isActive, activeColumn, allowedFields };
}