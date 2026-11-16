/* Approved R8: one scene every seven seconds, no transition or focus changes. */
(function (root) {
  "use strict";
  var SCENES = [
    {
      title: "Клиент интересуется услугой",
      caption: "Учебный диалог · данные вымышлены.",
    },
    {
      title: "Обращение и потенциал сделки",
      caption: "Учебная сумма услуги из каталога.",
    },
    {
      title: "Примеры обещали вчера",
      caption: "Вчера обещали прислать примеры.\nСегодня их ещё нет.",
    },
    {
      title: "LidRadar показывает риск",
      caption: "AI может ошибаться.\nСигнал проверяет сотрудник.",
    },
    {
      title: "Приходит сводка в Telegram",
      caption: "Учебный пример. Для риска выбран\nрежим ежедневной сводки.",
    },
  ];
  var instances = new WeakMap();
  function init(element, doc, clock) {
    if (instances.has(element)) return instances.get(element);
    doc = doc || document;
    clock = clock || root;
    var images = Array.from(element.querySelectorAll(".phone-scene"));
    var title = element.querySelector("#scene-title");
    var caption = element.querySelector("#scene-caption");
    if (images.length !== SCENES.length || !title || !caption) return null;
    var index = 0,
      timer = null,
      disposed = false;
    // Decode upcoming scenes before showing them. A failed image never replaces the current one.
    var ready = images.map(function (image, i) {
      return i === 0
        ? Promise.resolve(true)
        : typeof image.decode === "function"
          ? image.decode().then(
              function () {
                return true;
              },
              function () {
                return false;
              },
            )
          : Promise.resolve(true);
    });
    function render(next) {
      images.forEach(function (image, i) {
        image.hidden = i !== next;
      });
      title.textContent = SCENES[next].title;
      caption.textContent = SCENES[next].caption;
      index = next;
    }
    function stop() {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    }
    function schedule() {
      stop();
      if (disposed || doc.hidden) return;
      timer = clock.setTimeout(function () {
        timer = null;
        var next = (index + 1) % SCENES.length;
        ready[next].then(function (loaded) {
          if (disposed || doc.hidden) return;
          if (loaded) render(next);
          schedule();
        });
      }, 7000);
    }
    function visibility() {
      if (doc.hidden) stop();
      else schedule();
    }
    function destroy() {
      if (disposed) return;
      disposed = true;
      stop();
      doc.removeEventListener("visibilitychange", visibility);
      if (root.removeEventListener) {
        root.removeEventListener("pagehide", stop);
        root.removeEventListener("pageshow", visibility);
      }
      instances.delete(element);
    }
    render(0);
    doc.addEventListener("visibilitychange", visibility);
    if (root.addEventListener) {
      root.addEventListener("pagehide", stop);
      root.addEventListener("pageshow", visibility);
    }
    var api = { destroy: destroy };
    instances.set(element, api);
    schedule();
    return api;
  }
  var api = { init: init, scenes: SCENES };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LidRadarSlideshow = api;
})(typeof window === "undefined" ? globalThis : window);
