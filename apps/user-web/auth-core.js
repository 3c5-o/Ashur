((root) => {
  "use strict";

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function normalizeEmail(value = "") {
    return String(value).trim().toLowerCase();
  }

  function validEmail(value = "") {
    const email = normalizeEmail(value);
    return email.length <= 254 && EMAIL_RE.test(email);
  }

  function validPassword(value = "") {
    return String(value).length >= 8;
  }

  function validUsername(value = "") {
    return /^[a-z0-9_]{3,24}$/.test(String(value).trim().toLowerCase());
  }

  function buildRedirect(base, flow) {
    const fallback = "ashur://reset-password";
    const url = new URL(String(base || fallback));
    if (flow) url.searchParams.set("flow", flow);
    return url.toString();
  }

  function parseAuthLink(value = "") {
    const url = new URL(String(value || ""));
    const query = url.searchParams;
    const hash = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
    const rawType = String(query.get("type") || hash.get("type") || "").toLowerCase();
    const explicitFlow = String(query.get("flow") || "").toLowerCase();
    let flow = explicitFlow;
    if (!flow) {
      if (rawType === "recovery") flow = "recovery";
      else if (["signup", "email", "email_change", "magiclink"].includes(rawType)) flow = "signup";
      else if (url.hostname === "reset-password") flow = "recovery";
      else flow = "signin";
    }
    return {
      url,
      flow,
      type: rawType,
      code: query.get("code") || "",
      flowId: query.get("sb_flow_id") || "",
      accessToken: hash.get("access_token") || "",
      refreshToken: hash.get("refresh_token") || "",
      error: query.get("error") || hash.get("error") || "",
      errorCode: query.get("error_code") || hash.get("error_code") || "",
      errorDescription: query.get("error_description") || hash.get("error_description") || ""
    };
  }

  function errorMessage(error, fallback = "تعذر تنفيذ العملية. حاول مرة أخرى.") {
    const code = String(error?.code || error?.error_code || "").toLowerCase();
    const message = String(error?.message || error?.error_description || "").toLowerCase();

    if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
      return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
    }
    if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
      return "يجب تأكيد البريد الإلكتروني قبل تسجيل الدخول.";
    }
    if (code === "user_already_exists" || code === "user_already_registered" || message.includes("already registered")) {
      return "يوجد حساب مسجل بهذا البريد الإلكتروني.";
    }
    if (code === "weak_password" || message.includes("password should be") || message.includes("weak password")) {
      return "كلمة المرور ضعيفة. استخدم ٨ أحرف أو أكثر.";
    }
    if (code === "same_password" || message.includes("same password")) {
      return "اختر كلمة مرور جديدة مختلفة عن الحالية.";
    }
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || message.includes("rate limit")) {
      return "تم إرسال طلبات كثيرة. حاول مرة أخرى بعد قليل.";
    }
    if (code === "otp_expired" || code === "flow_state_expired" || message.includes("expired")) {
      return "الرابط منتهي الصلاحية. اطلب رابطًا جديدًا.";
    }
    if (code === "otp_disabled" || message.includes("otp disabled")) {
      return "تعذر استخدام رابط التحقق حاليًا.";
    }
    if (code === "validation_failed" || message.includes("invalid email")) {
      return "تحقق من البريد الإلكتروني والبيانات المدخلة.";
    }
    if (message.includes("failed to fetch") || message.includes("network") || message.includes("fetch")) {
      return "تعذر الاتصال بالخدمة. تحقق من الإنترنت وحاول مرة أخرى.";
    }
    return fallback;
  }

  root.AshurAuth = Object.freeze({
    normalizeEmail,
    validEmail,
    validPassword,
    validUsername,
    buildRedirect,
    parseAuthLink,
    errorMessage
  });
})(typeof window !== "undefined" ? window : globalThis);
