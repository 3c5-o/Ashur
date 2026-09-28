((root) => {
  "use strict";

  const IMAGE_TYPES = new Set(["image/jpeg","image/png","image/webp","image/avif"]);

  function normalizeName(value = "") {
    return String(value).trim().replace(/\s+/g, " ");
  }

  function normalizeUsername(value = "") {
    return String(value).trim().toLowerCase();
  }

  function normalizeBio(value = "") {
    return String(value).trim();
  }

  function normalizeProfileLink(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const candidate = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
    const url = new URL(candidate);
    if (!["http:","https:"].includes(url.protocol)) throw new Error("الرابط يجب أن يبدأ بـ http أو https.");
    if (url.username || url.password) throw new Error("الرابط لا يقبل بيانات دخول داخله.");
    const normalized = url.href;
    if (normalized.length > 220) throw new Error("الرابط أطول من الحد المسموح.");
    return normalized;
  }

  function validateProfile(input = {}) {
    const value = {
      name: normalizeName(input.name),
      username: normalizeUsername(input.username),
      bio: normalizeBio(input.bio),
      profile_link: "",
      is_private: Boolean(input.is_private)
    };

    if (value.name.length < 1 || value.name.length > 80) {
      return { ok:false, error:"الاسم يجب أن يكون بين ١ و٨٠ حرفًا.", value };
    }
    if (!/^[a-z0-9_]{3,24}$/.test(value.username)) {
      return { ok:false, error:"اسم المستخدم يقبل الحروف الإنجليزية والأرقام والشرطة السفلية، من ٣ إلى ٢٤ خانة.", value };
    }
    if (value.bio.length > 300) {
      return { ok:false, error:"النبذة يجب ألا تتجاوز ٣٠٠ حرف.", value };
    }
    try {
      value.profile_link = normalizeProfileLink(input.profile_link);
    } catch (error) {
      return { ok:false, error:error.message || "الرابط غير صالح.", value };
    }
    return { ok:true, error:"", value };
  }

  function validateImageFile(file, maxBytes = 10 * 1024 * 1024) {
    if (!file) return { ok:true, error:"" };
    if (!IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
      return { ok:false, error:"صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP أو AVIF." };
    }
    if (file.size <= 0) return { ok:false, error:"ملف الصورة فارغ." };
    if (file.size > maxBytes) return { ok:false, error:"الصورة يجب ألا تتجاوز ١٠ ميغابايت." };
    return { ok:true, error:"" };
  }

  function errorMessage(error, fallback = "تعذر حفظ التعديلات.") {
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    if (code === "23505" || message.includes("duplicate") || message.includes("unique")) {
      return "اسم المستخدم مستخدم بالفعل.";
    }
    if (code === "23514" || message.includes("check constraint")) {
      return "إحدى بيانات الملف لا تطابق الشروط المسموحة.";
    }
    if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) {
      return "تعذر حفظ هذه التعديلات. تأكد أن الصور تخص حسابك ثم حاول مرة أخرى.";
    }
    if (code === "23503" || message.includes("foreign key")) {
      return "الصورة أو الغلاف المختار لم يعد متاحًا.";
    }
    if (message.includes("failed to fetch") || message.includes("network")) {
      return "تعذر الاتصال بالخدمة. تحقق من الإنترنت وحاول مرة أخرى.";
    }
    return fallback;
  }

  root.AshurProfile = Object.freeze({
    IMAGE_TYPES,
    normalizeName,
    normalizeUsername,
    normalizeBio,
    normalizeProfileLink,
    validateProfile,
    validateImageFile,
    errorMessage
  });
})(typeof window !== "undefined" ? window : globalThis);
