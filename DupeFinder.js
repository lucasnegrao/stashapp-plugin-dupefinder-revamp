// DupeFinder bootstrap
(function () {
  "use strict";
  console.log("[DupeFinder] Script loaded modular v2");
  const root = window.DupeFinder = window.DupeFinder || {};
  if (!root.modal || typeof root.modal.schedule !== "function") {
    console.error("[DupeFinder] Modal controller was not initialized");
    return;
  }
  root.modal.schedule();
})();
