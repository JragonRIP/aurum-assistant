(function () {
  const status = document.getElementById("status");
  const orb = document.getElementById("orb");
  const command = document.getElementById("command");
  const commandWrap = document.getElementById("commandWrap");
  const pairWrap = document.getElementById("pairWrap");
  const pairCode = document.getElementById("pairCode");
  const pairBtn = document.getElementById("pairBtn");
  const hint = document.getElementById("hint");

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  function showPairing(show) {
    if (pairWrap) pairWrap.classList.toggle("visible", show);
    if (commandWrap) commandWrap.style.display = show ? "none" : "block";
    if (hint) {
      hint.textContent = show
        ? "Enter the pairing code from Aurum → Devices"
        : "Press Enter to send · Esc to dismiss";
    }
  }

  async function refresh() {
    try {
      const info = await window.aurumDesktop.getInfo();
      if (!info.paired) {
        setStatus("Connect");
        showPairing(true);
        pairCode?.focus();
        return;
      }
      showPairing(false);
      setStatus(info.online ? "Idle" : "Offline");
      command?.focus();
      command?.select();
    } catch {
      setStatus("Ready");
      command?.focus();
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      void window.aurumDesktop.hideOverlay();
    }
  });

  command?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const text = command.value.trim();
    if (!text) return;
    setStatus("Thinking");
    orb?.classList.add("thinking");
    void window.aurumDesktop.submitOverlayCommand(text).then((res) => {
      orb?.classList.remove("thinking");
      if (!res.ok) setStatus("Error");
      else {
        command.value = "";
        setStatus("Idle");
      }
    });
  });

  pairBtn?.addEventListener("click", () => {
    const code = pairCode?.value.trim() ?? "";
    if (!code) return;
    setStatus("Pairing");
    void window.aurumDesktop.pairDevice(code).then((res) => {
      if (!res.ok) {
        setStatus("Failed");
        return;
      }
      setStatus("Connected");
      showPairing(false);
      void refresh();
    });
  });

  if (window.aurumDesktop?.onOverlayShown) {
    window.aurumDesktop.onOverlayShown(() => {
      void refresh();
    });
  }

  void refresh();
})();
