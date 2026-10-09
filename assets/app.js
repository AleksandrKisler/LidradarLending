(function () {
  "use strict";

  /* Адрес приёма заявок на бета-тест. Пока пусто: форма проверяет данные и показывает
     успех, но ничего не отправляет (режим черновика). Укажите URL, который принимает
     POST с JSON, например "https://example.com/api/beta". */
  var FORM_ENDPOINT = "";

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

  function isContactValid(value) {
    var v = value.trim();
    if (/^(https?:\/\/)?t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\/?$/.test(v)) return true;
    if (/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v)) return true;
    var digits = v.replace(/[\s()+\-.]/g, "");
    return /^\d{10,15}$/.test(digits) && /^[\d\s()+\-.]+$/.test(v);
  }

  var checks = [
    {
      field: function () { return $("f-name").closest(".field"); },
      msg: "e-name",
      run: function () {
        return $("f-name").value.trim() ? "" : "Укажите имя";
      }
    },
    {
      field: function () { return $("f-company").closest(".field"); },
      msg: "e-company",
      run: function () {
        return $("f-company").value.trim() ? "" : "Укажите название компании";
      }
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
      run: function () {
        var v = $("f-contact").value;
        if (!v.trim()) return "Укажите Telegram или телефон";
        return isContactValid(v) ? "" : "Проверьте контакт: нужен Telegram вида @username или телефон с кодом";
      }
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

    var payload = {
      name: String(data.get("name")).trim(),
      company: String(data.get("company")).trim(),
      business: String(data.get("business")),
      contact: String(data.get("contact")).trim(),
      locations: data.get("locations") ? Number(data.get("locations")) : null,
      consent: true,
      source: "landing",
      submittedAt: new Date().toISOString()
    };

    setBusy(true);

    var request;
    if (FORM_ENDPOINT) {
      request = fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
      });
    } else {
      console.warn("[LidRadar] FORM_ENDPOINT не задан в assets/app.js: заявка никуда не отправлена.", payload);
      request = Promise.resolve();
    }

    request
      .then(function () { showDone(payload.name); })
      .catch(function () {
        formError.classList.add("is-visible");
        formError.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
      })
      .then(function () { setBusy(false); });
  });
})();
