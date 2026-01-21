"use strict";

// Build the demo accounts panel dynamically
function buildDemoInfo() {
  var panel = document.createElement("div");
  panel.className = "auth-info glass";
  panel.id = "demoInfo";
  panel.setAttribute("style", "border-left: 4px solid var(--agri-green)");
  panel.setAttribute("hidden", "hidden");
  panel.innerHTML = `
      <h3>
        <i class="fas fa-seedling" style="color: var(--agri-green)"></i>
        Demo Accounts
      </h3>
      <p>You can use these demo accounts for testing:</p>
      <div class="demo-accounts">
        <div class="demo-account" id="demoAccount1" style="outline: none; margin-bottom: 1rem; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 0.5rem;">
          <strong>Empty Demo User:</strong><br />
          Email: <span class="demo-email">emptyuser@rolnopol.demo.pl</span>
          <button type="button" class="btn btn-xs btn-outline copyDemoBtn" data-copy="emptyuser@rolnopol.demo.pl" aria-label="Copy demo email"><i class="fa-regular fa-copy"></i></button><br />
          Password: <span class="demo-pass">demoPass123</span>
          <button type="button" class="btn btn-xs btn-outline copyDemoBtn" data-copy="demoPass123" aria-label="Copy demo password"><i class="fa-regular fa-copy"></i></button><br />
          <button type="button" class="fillDemoBtn" data-email="emptyuser@rolnopol.demo.pl" data-password="demoPass123" style="margin-top: 0.5rem">Fill Login Fields</button>
        </div>
        <div class="demo-account" id="demoAccount2" style="outline: none; margin-bottom: 1rem; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 0.5rem;">
          <strong>Demo User:</strong><br />
          Email: <span class="demo-email">demo@example.com</span>
          <button type="button" class="btn btn-xs btn-outline copyDemoBtn" data-copy="demo@example.com" aria-label="Copy demo email"><i class="fa-regular fa-copy"></i></button><br />
          Password: <span class="demo-pass">demo123</span>
          <button type="button" class="btn btn-xs btn-outline copyDemoBtn" data-copy="demo123" aria-label="Copy demo password"><i class="fa-regular fa-copy"></i></button><br />
          <button type="button" class="fillDemoBtn" data-email="demo@example.com" data-password="demo123" style="margin-top: 0.5rem">Fill Login Fields</button>
        </div>
        <div class="demo-account" id="demoAccount3" style="outline: none; margin-bottom: 1rem; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 0.5rem;">
          <strong>Demo User 2:</strong><br />
          Email: <span class="demo-email">test@example.com</span>
          <button type="button" class="btn btn-xs btn-outline copyDemoBtn" data-copy="test@example.com" aria-label="Copy demo email"><i class="fa-regular fa-copy"></i></button><br />
          Password: <span class="demo-pass">brownPass123</span>
          <button type="button" class="btn btn-xs btn-outline copyDemoBtn" data-copy="brownPass123" aria-label="Copy demo password"><i class="fa-regular fa-copy"></i></button><br />
          <button type="button" class="fillDemoBtn" data-email="test@example.com" data-password="brownPass123" style="margin-top: 0.5rem">Fill Login Fields</button>
        </div>
      </div>`;
  return panel;
}

function attachDemoHandlers(root) {
  var demoBtns = root.querySelectorAll(".fillDemoBtn");
  demoBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var email = this.getAttribute("data-email");
      var password = this.getAttribute("data-password");
      document.getElementById("email").value = email;
      document.getElementById("password").value = password;
      document.getElementById("email").focus();
    });
  });

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var tempInput = document.createElement("input");
      tempInput.value = text;
      tempInput.setAttribute("readonly", "readonly");
      tempInput.style.position = "absolute";
      tempInput.style.left = "-9999px";
      document.body.appendChild(tempInput);
      tempInput.select();
      var copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (err) {
        copied = false;
      }
      document.body.removeChild(tempInput);
      if (copied) {
        resolve();
      } else {
        reject(new Error("Copy failed"));
      }
    });
  }

  var copyBtns = root.querySelectorAll(".copyDemoBtn");
  copyBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = this.getAttribute("data-copy");
      if (!text) return;

      var button = this;

      copyTextToClipboard(text)
        .then(function () {
          button.disabled = true;
          setTimeout(function () {
            button.disabled = false;
          }, 1200);
        })
        .catch(function () {
          setTimeout(function () {}, 1400);
        });
    });
  });
}

// Expose a console helper to toggle the demo accounts section
window.showDemo = function () {
  var panel = document.getElementById("demoInfo");
  if (!panel) {
    var parent = document.querySelector(".auth-form-container");
    if (!parent) {
      console.warn("Auth form container not found.");
      return;
    }
    panel = buildDemoInfo();
    parent.appendChild(panel);
    attachDemoHandlers(panel);
    panel.hidden = false;
    panel.style.display = "";
    console.info("Demo accounts are now visible.");
    return;
  }
  var isHidden = panel.hidden || panel.style.display === "none";
  if (isHidden) {
    panel.hidden = false;
    panel.style.display = "";
    console.info("Demo accounts are now visible.");
  } else {
    panel.hidden = true;
    console.info("Demo accounts are now hidden.");
  }
};

window.demo = window.showDemo; // Alias for easier access
