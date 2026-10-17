(function () {
  "use strict";

  /* Адрес приёма заявок на бета-тест. Заявки принимает server.mjs (запускается рядом с index.html)
     и дописывает в файл leads.jsonl на сервере. Адрес относительный: сайт и приём работают на одном домене.
     Если открыть страницу не через server.mjs (например, python3 -m http.server или файл с диска),
     приёма нет и форма покажет ошибку отправки. Подробности: README.md, раздел «Приём заявок». */
  var FORM_ENDPOINT = "/api/lead";

  /* Дата релиза: 15 октября 2026 (месяцы в JS с нуля) */
  var RELEASE = new Date(2026, 9, 15);

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Верхняя панель: тональная поверхность при прокрутке ---------- */
  var appbar = $("appbar");
  function onScroll() {
    appbar.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Обратный отсчёт ---------- */
  function plural(n, forms) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return forms[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
    return forms[2];
  }

  var countdown = $("countdown");
  if (countdown) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var days = Math.round((RELEASE - today) / 86400000);
    if (days > 1) {
      countdown.textContent = "До старта " + days + " " + plural(days, ["день", "дня", "дней"]) + ".";
    } else if (days === 1) {
      countdown.textContent = "Старт завтра.";
    } else if (days === 0) {
      countdown.textContent = "Старт сегодня.";
    }
  }

  /* ---------- Хронология: состояния по сегодняшней дате ----------
     Прошедшие события отмечаются галочкой, ближайшее подсвечивается, линия заполняется до «сегодня».
     Событие с атрибутом data-pending ещё не подтверждено и в расчёт не входит. */
  var tl = $("tl");
  var tlScroll = $("tl-scroll");
  if (tl && tlScroll) {
    var tlItems = Array.prototype.slice.call(tl.querySelectorAll(".tl__item"));
    var tlTime = function (el) {
      var p = el.getAttribute("data-date").split("-");
      return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
    };
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var nowMs = now.getTime();

    var nextIdx = -1;
    tlItems.forEach(function (el, i) {
      var pending = el.hasAttribute("data-pending");
      var past = !pending && tlTime(el) < nowMs;
      el.classList.toggle("is-done", past);
      el.classList.remove("is-next");
      if (!pending && !past && nextIdx === -1) nextIdx = i;
    });
    if (nextIdx !== -1) tlItems[nextIdx].classList.add("is-next");

    /* Линия идёт от первой до последней точки, шаг между точками одинаковый */
    var lastDone = -1;
    tlItems.forEach(function (el, i) {
      if (el.classList.contains("is-done")) lastDone = i;
    });
    var progress = 0;
    if (lastDone >= 0) {
      var frac = 0;
      if (nextIdx !== -1) {
        var from = tlTime(tlItems[lastDone]);
        var to = tlTime(tlItems[nextIdx]);
        frac = Math.min(1, Math.max(0, (nowMs - from) / (to - from)));
      }
      progress = (lastDone + frac) / (tlItems.length - 1);
    }
    tl.querySelector(".tl__axis").style.setProperty("--progress", (progress * 100).toFixed(2) + "%");

    /* На узких экранах хронология прокручивается: показываем ближайшее событие */
    if (nextIdx !== -1 && tlScroll.scrollWidth > tlScroll.clientWidth + 4) {
      var dot = tlItems[nextIdx].querySelector(".tl__dot").getBoundingClientRect();
      var box = tlScroll.getBoundingClientRect();
      tlScroll.scrollLeft += dot.left + dot.width / 2 - (box.left + box.width / 2);
    }
  }

  /* ---------- Ripple для кнопок ---------- */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion) {
    document.addEventListener("pointerdown", function (e) {
      var btn = e.target.closest(".btn");
      if (!btn || btn.disabled) return;
      var rect = btn.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height) * 2;
      var dot = document.createElement("span");
      dot.className = "ripple";
      dot.style.width = dot.style.height = size + "px";
      dot.style.left = e.clientX - rect.left - size / 2 + "px";
      dot.style.top = e.clientY - rect.top - size / 2 + "px";
      btn.appendChild(dot);
      dot.addEventListener("animationend", function () { dot.remove(); });
    });
  }

  /* ---------- Snackbar ---------- */
  var snackbar = $("snackbar");
  var snackTimer;
  function showSnackbar(text) {
    $("snackbar-text").textContent = text;
    snackbar.classList.add("is-visible");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(function () { snackbar.classList.remove("is-visible"); }, 5000);
  }

  /* ---------- Форма записи на бета-тест ---------- */
  var form = $("beta-form");
  if (!form) return;

  var submitBtn = $("submit-btn");
  var submitLabel = $("submit-label");
  var formError = $("form-error");

  function setError(wrapper, msgId, text) {
    var msg = $(msgId);
    msg.textContent = text || "";
    wrapper.classList.toggle("is-invalid", Boolean(text));
    var input = wrapper.querySelector("input");
    if (input && wrapper.classList.contains("field")) {
      input.setAttribute("aria-invalid", text ? "true" : "false");
    }
  }

  /* Правила проверки имени, компании и контакта лежат в assets/validate.js: те же правила
     применяет server.mjs, поэтому заявку нельзя обойти прямым запросом. */
  var V = window.LidRadarValidate;

  var MESSAGES = {
    name: {
      empty: "Укажите имя",
      short: "Имя слишком короткое: нужно хотя бы две буквы",
      long: "Слишком длинное имя: не больше 60 знаков",
      chars: "В имени допустимы только буквы, пробел, дефис и апостроф",
      gibberish: "Это не похоже на имя. Проверьте, пожалуйста"
    },
    company: {
      empty: "Укажите название компании",
      short: "Название слишком короткое: нужно хотя бы две буквы",
      long: "Слишком длинное название: не больше 100 знаков",
      chars: "В названии лишние символы: уберите ссылки и спецсимволы",
      gibberish: "Это не похоже на название компании. Проверьте, пожалуйста"
    },
    contact: {
      empty: "Укажите Telegram или email",
      long: "Слишком длинный контакт",
      phone: "Телефон не принимаем: укажите Telegram (@username) или email",
      placeholder: "Укажите свой настоящий Telegram или email, а не пример",
      format: "Проверьте контакт: нужен Telegram вида @username или email вида name@example.com"
    }
  };

  /* Текст ошибки для поля или пустая строка, если всё в порядке */
  function problem(kind, value) {
    var result = kind === "name" ? V.checkName(value) : kind === "company" ? V.checkCompany(value) : V.checkContact(value);
    return result.ok ? "" : MESSAGES[kind][result.reason] || MESSAGES[kind].empty;
  }

  var checks = [
    {
      field: function () { return $("f-name").closest(".field"); },
      msg: "e-name",
      run: function () { return problem("name", $("f-name").value); }
    },
    {
      field: function () { return $("f-company").closest(".field"); },
      msg: "e-company",
      run: function () { return problem("company", $("f-company").value); }
    },
    {
      field: function () { return $("f-business"); },
      msg: "e-business",
      run: function () {
        return form.querySelector('input[name="business"]:checked') ? "" : "Выберите, чем занимаетесь";
      }
    },
    {
      field: function () { return $("f-contact").closest(".field"); },
      msg: "e-contact",
      run: function () { return problem("contact", $("f-contact").value); }
    },
    {
      field: function () { return $("f-locations").closest(".field"); },
      msg: "e-locations",
      run: function () {
        var v = $("f-locations").value.trim();
        if (!v) return "";
        var n = Number(v);
        return Number.isInteger(n) && n >= 1 && n <= 999 ? "" : "Укажите число точек от 1 до 999";
      }
    }
  ];

  function validate() {
    var firstInvalid = null;

    checks.forEach(function (c) {
      var wrapper = c.field();
      var text = c.run();
      setError(wrapper, c.msg, text);
      if (text && !firstInvalid) {
        firstInvalid = wrapper.querySelector("input");
      }
    });

    var consent = $("f-consent");
    var consentMsg = $("e-consent");
    var consentLabel = $("consent-label");
    var consentOk = consent.checked;
    consentMsg.textContent = consentOk ? "" : "Подтвердите согласие, чтобы отправить заявку";
    consentMsg.classList.toggle("is-visible", !consentOk);
    consentLabel.classList.toggle("is-invalid", !consentOk);
    consent.setAttribute("aria-invalid", consentOk ? "false" : "true");
    if (!consentOk && !firstInvalid) firstInvalid = consent;

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  /* Ошибка пропадает, как только человек начал её исправлять */
  form.addEventListener("input", function (e) {
    attemptId = null; /* данные изменились: это уже новая заявка, а не повтор прошлой попытки */
    var field = e.target.closest(".field, .choice");
    if (field && field.classList.contains("is-invalid")) {
      var check = checks.find(function (c) { return c.field() === field; });
      if (check && !check.run()) setError(field, check.msg, "");
    }
    if (e.target.id === "f-consent" && e.target.checked) {
      $("e-consent").classList.remove("is-visible");
      $("consent-label").classList.remove("is-invalid");
      e.target.setAttribute("aria-invalid", "false");
    }
    formError.classList.remove("is-visible");
  });

  /* Номер заявки: при повторной отправке после сбоя связи сервер не создаст вторую строку.
     Пока человек ничего не менял, номер остаётся прежним. */
  var attemptId = null;
  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  /* Откуда пришёл человек: метки рекламы и сайт-источник. Помогают понять, какой канал работает. */
  function utmLabel() {
    try {
      var q = new URLSearchParams(window.location.search);
      return ["utm_source", "utm_medium", "utm_campaign"]
        .map(function (k) { return q.get(k) || ""; })
        .filter(Boolean)
        .join(" / ");
    } catch (err) {
      return "";
    }
  }
  function referrerHost() {
    try {
      var host = document.referrer ? new URL(document.referrer).hostname : "";
      return host === window.location.hostname ? "" : host;
    } catch (err) {
      return "";
    }
  }

  function isLocalPreview() {
    var h = window.location.hostname;
    return window.location.protocol === "file:" || h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "";
  }

  /* Отправка заявки на server.mjs. Ответ: { ok: true } или { ok: false, error }. */
  function sendLead(payload) {
    if (!FORM_ENDPOINT) {
      if (isLocalPreview()) {
        console.warn("[LidRadar] FORM_ENDPOINT не задан в assets/app.js: заявка никуда не отправлена (режим проверки вёрстки).", payload);
        return Promise.resolve();
      }
      console.error("[LidRadar] FORM_ENDPOINT не задан в assets/app.js: заявка не отправлена.");
      return Promise.reject(new Error("FORM_ENDPOINT is empty"));
    }

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, 20000) : 0;
    var done = function () { if (timer) window.clearTimeout(timer); };

    return fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (answer) {
        if (!answer || answer.ok !== true) throw new Error("Сервер отклонил заявку: " + (answer && answer.error));
      })
      .then(
        function () { done(); },
        function (err) { done(); throw err; }
      );
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    form.setAttribute("aria-busy", busy ? "true" : "false");
    submitLabel.textContent = busy ? "Отправляем…" : "Записаться на бета-тест";
  }

  function showDone(name) {
    var done = $("form-done");
    var first = name.trim().split(/\s+/)[0];
    $("done-text").textContent =
      (first ? "Спасибо, " + first + "! " : "Спасибо! ") +
      "Мы свяжемся с вами по указанному контакту. Бета-тест стартует 15 октября.";
    form.hidden = true;
    $("form-head").hidden = true;
    done.hidden = false;
    done.focus();
    showSnackbar("Заявка отправлена");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    formError.classList.remove("is-visible");
    if (!validate()) return;

    var data = new FormData(form);

    /* Поле-ловушка для ботов: делаем вид, что всё хорошо, но ничего не отправляем */
    if (String(data.get("website") || "").trim()) {
      showDone(String(data.get("name") || ""));
      return;
    }

    if (!attemptId) attemptId = newId();
    /* В таблицу уходят значения в едином виде: без лишних пробелов, Telegram как @имя, email строчными */
    var payload = {
      id: attemptId,
      name: V.checkName(data.get("name")).value,
      company: V.checkCompany(data.get("company")).value,
      business: String(data.get("business")),
      contact: V.checkContact(data.get("contact")).value,
      locations: data.get("locations") ? Number(data.get("locations")) : null,
      consent: true,
      source: "landing",
      utm: utmLabel(),
      referrer: referrerHost(),
      submittedAt: new Date().toISOString()
    };

    setBusy(true);

    sendLead(payload)
      .then(function () {
        attemptId = null;
        showDone(payload.name);
      })
      .catch(function (err) {
        console.error("[LidRadar] Заявка не отправлена:", err);
        formError.classList.add("is-visible");
        formError.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
      })
      .then(function () { setBusy(false); });
  });
})();
