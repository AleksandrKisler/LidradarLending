(function () {
  "use strict";
  var FORM_ENDPOINT = "/api/lead";
  var $ = function (id) {
    return document.getElementById(id);
  };
  var reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  var toggle = $("menu-toggle");
  var menu = $("mobile-nav");
  function closeMenu(restoreFocus) {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener("click", function () {
    var open = toggle.getAttribute("aria-expanded") !== "true";
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  $("menu-close").addEventListener("click", function () {
    closeMenu(true);
  });
  menu.addEventListener("click", function (event) {
    if (event.target.closest("a")) closeMenu(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !menu.hidden) closeMenu(true);
  });
  document.addEventListener("click", function (event) {
    if (!menu.hidden && !event.target.closest(".nav-shell")) closeMenu(false);
  });
  var desktop = window.matchMedia("(min-width: 1200px)");
  desktop.addEventListener("change", function () {
    closeMenu(false);
  });

  // Native details/summary keeps all FAQ answers available without JavaScript.
  var slideshow = $("hero-slideshow");
  if (slideshow && window.LidRadarSlideshow) {
    window.LidRadarSlideshow.init(slideshow, document);
  }

  /* ---------- Форма заявки на демонстрацию ---------- */
  var form = $("beta-form");
  if (!form) return;

  var submitBtn = $("submit-btn");
  var submitLabel = $("submit-label");
  var formError = $("form-error");

  function setError(wrapper, msgId, text) {
    var msg = $(msgId);
    msg.textContent = text || "";
    wrapper.classList.toggle("is-invalid", Boolean(text));
    var input = wrapper.querySelector("input, select");
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
      gibberish: "Это не похоже на имя. Проверьте, пожалуйста",
    },
    company: {
      empty: "Укажите название компании",
      short: "Название слишком короткое: нужно хотя бы две буквы",
      long: "Слишком длинное название: не больше 100 знаков",
      chars: "В названии лишние символы: уберите ссылки и спецсимволы",
      gibberish: "Это не похоже на название компании. Проверьте, пожалуйста",
    },
    contact: {
      empty: "Укажите Telegram или email",
      long: "Слишком длинный контакт",
      phone:
        "Укажите Telegram вида @username или email. Телефон не принимается",
      placeholder: "Укажите свой настоящий Telegram или email, а не пример",
      format:
        "Проверьте контакт: нужен Telegram вида @username или email вида name@example.com",
    },
  };

  /* Текст ошибки для поля или пустая строка, если всё в порядке */
  function problem(kind, value) {
    var result =
      kind === "name"
        ? V.checkName(value)
        : kind === "company"
          ? V.checkCompany(value)
          : V.checkContact(value);
    return result.ok
      ? ""
      : MESSAGES[kind][result.reason] || MESSAGES[kind].empty;
  }

  var checks = [
    {
      field: function () {
        return $("f-name").closest(".field");
      },
      msg: "e-name",
      run: function () {
        return problem("name", $("f-name").value);
      },
    },
    {
      field: function () {
        return $("f-company").closest(".field");
      },
      msg: "e-company",
      run: function () {
        return problem("company", $("f-company").value);
      },
    },
    {
      field: function () {
        return $("f-business").closest(".field");
      },
      msg: "e-business",
      run: function () {
        return $("f-business").value ? "" : "Выберите, чем занимается компания";
      },
    },
    {
      field: function () {
        return $("f-contact").closest(".field");
      },
      msg: "e-contact",
      run: function () {
        return problem("contact", $("f-contact").value);
      },
    },
    {
      field: function () {
        return $("f-locations").closest(".field");
      },
      msg: "e-locations",
      run: function () {
        var v = $("f-locations").value.trim();
        if (!v) return "";
        var n = Number(v);
        return Number.isInteger(n) && n >= 1 && n <= 999
          ? ""
          : "Укажите целое число точек от 1 до 999";
      },
    },
  ];

  function validate() {
    var firstInvalid = null;

    checks.forEach(function (c) {
      var wrapper = c.field();
      var text = c.run();
      setError(wrapper, c.msg, text);
      if (text && !firstInvalid) {
        firstInvalid = wrapper.querySelector("input, select");
      }
    });

    var consent = $("f-consent");
    var consentMsg = $("e-consent");
    var consentLabel = $("consent-label");
    var consentOk = consent.checked;
    consentMsg.textContent = consentOk
      ? ""
      : "Подтвердите согласие, чтобы отправить заявку";
    consentMsg.classList.toggle("is-visible", !consentOk);
    consentLabel.classList.toggle("is-invalid", !consentOk);
    consent.setAttribute("aria-invalid", consentOk ? "false" : "true");
    if (!consentOk && !firstInvalid) firstInvalid = consent;

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  /* Ошибка пропадает, как только человек начал её исправлять */
  form.addEventListener("input", function (e) {
    attemptId =
      null; /* данные изменились: это уже новая заявка, а не повтор прошлой попытки */
    var field = e.target.closest(".field, .choice");
    if (field && field.classList.contains("is-invalid")) {
      var check = checks.find(function (c) {
        return c.field() === field;
      });
      if (check && !check.run()) setError(field, check.msg, "");
    }
    if (e.target.id === "f-consent" && e.target.checked) {
      $("e-consent").textContent = "";
      $("e-consent").classList.remove("is-visible");
      $("consent-label").classList.remove("is-invalid");
      e.target.setAttribute("aria-invalid", "false");
    }
    formError.hidden = true;
    submitLabel.textContent = "Обсудить демонстрацию";
  });

  /* Номер заявки: при повторной отправке после сбоя связи сервер не создаст вторую строку.
     Пока человек ничего не менял, номер остаётся прежним. */
  var attemptId = null;
  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function")
      return window.crypto.randomUUID();
    return (
      "id-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 12)
    );
  }

  /* Откуда пришёл человек: метки рекламы и сайт-источник. Помогают понять, какой канал работает. */
  function utmLabel() {
    try {
      var q = new URLSearchParams(window.location.search);
      return ["utm_source", "utm_medium", "utm_campaign"]
        .map(function (k) {
          return q.get(k) || "";
        })
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

  /* Успех подтверждается только ответом { ok: true } от существующего endpoint. */
  function sendLead(payload) {
    var controller =
      typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, 20000)
      : 0;
    var done = function () {
      if (timer) window.clearTimeout(timer);
    };

    return fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (answer) {
        if (!answer || answer.ok !== true)
          throw new Error(
            "Сервер отклонил заявку: " + (answer && answer.error),
          );
      })
      .then(
        function () {
          done();
        },
        function (err) {
          done();
          throw err;
        },
      );
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    $("submit-status").textContent = busy ? "Отправляем заявку…" : "";
    form.setAttribute("aria-busy", busy ? "true" : "false");
    form.querySelectorAll("input, select").forEach(function (input) {
      input.disabled = busy;
    });
    submitLabel.textContent = busy
      ? "Отправляем заявку…"
      : formError.hidden
        ? "Обсудить демонстрацию"
        : "Повторить отправку";
  }

  function showDone(name) {
    var done = $("form-done");
    $("done-text").textContent =
      "Спасибо! Свяжемся с вами по указанному контакту, чтобы обсудить задачу и согласовать демонстрацию.";
    form.hidden = true;
    $("form-head").hidden = true;
    done.hidden = false;
    done.focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitBtn.disabled) return;
    formError.hidden = true;
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
      submittedAt: new Date().toISOString(),
    };

    setBusy(true);

    sendLead(payload)
      .then(function () {
        attemptId = null;
        showDone(payload.name);
      })
      .catch(function (err) {
        /* При неоднозначном результате сохраняем ввод и attemptId для повтора. */
        formError.hidden = false;
        submitLabel.textContent = "Повторить отправку";
        formError.focus();
        formError.scrollIntoView({
          block: "nearest",
          behavior: reduceMotion ? "auto" : "smooth",
        });
      })
      .then(function () {
        setBusy(false);
      });
  });
})();
