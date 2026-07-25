/**
 * أدوات البحث الذكي - تدعم البحث الضبابي بالعربية
 * تطبيع النص العربي: توحيد الألف، التاء المربوطة، الألف المقصورة، والمسافات
 */

export function normalizeArabic(text) {
  if (!text) return "";
  return String(text)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * مطابقة ضبابية: هل يحتوي النص على الاستعلام؟
 * مثال: fuzzyMatch("مخ", "مخزن المدينة") → true
 * مثال: fuzzyMatch("مخ*ن*المع", "مخزن المدينة المنورة") → true (مع wildcard *)
 */
export function fuzzyMatch(query, text) {
  if (!query) return true;
  if (!text) return false;
  
  const normQuery = normalizeArabic(query);
  const normText = normalizeArabic(text);
  
  // دعم wildcard: "مخ*ن*المع" → regex "مخ.*ن.*المع"
  if (normQuery.includes("*")) {
    const escaped = normQuery
      .split("*")
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    try {
      return new RegExp(escaped).test(normText);
    } catch {
      return normText.includes(normQuery.replace(/\*/g, ""));
    }
  }
  
  return normText.includes(normQuery);
}

/**
 * تصفية قائمة بالبحث الضبابي على حقل معين
 */
export function fuzzyFilter(items, query, fieldOrFn) {
  if (!query) return items;
  return items.filter(item => {
    const value = typeof fieldOrFn === "function" ? fieldOrFn(item) : item[fieldOrFn];
    return fuzzyMatch(query, value);
  });
}