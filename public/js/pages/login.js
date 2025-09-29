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
        <div class="demo-account" id="demoAccount1" tabindex="0" style="cursor: pointer; outline: none; margin-bottom: 1rem; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 0.5rem;">
          <strong>Empty Demo User:</strong><br />
          Email: <span class="demo-email">emptyuser@rolnopol.demo.pl</span><br />
          Password: <span class="demo-pass">demoPass123</span><br />
          <button type="button" class="fillDemoBtn" data-email="emptyuser@rolnopol.demo.pl" data-password="demoPass123" style="margin-top: 0.5rem">Fill Login Fields</button>
        </div>
        <div class="demo-account" id="demoAccount2" tabindex="0" style="cursor: pointer; outline: none; margin-bottom: 1rem; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 0.5rem;">
          <strong>Demo User:</strong><br />
          Email: <span class="demo-email">demo@example.com</span><br />
          Password: <span class="demo-pass">demo123</span><br />
          <button type="button" class="fillDemoBtn" data-email="demo@example.com" data-password="demo123" style="margin-top: 0.5rem">Fill Login Fields</button>
        </div>
        <div class="demo-account" id="demoAccount3" tabindex="0" style="cursor: pointer; outline: none; margin-bottom: 1rem; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 0.5rem;">
          <strong>Demo User 2:</strong><br />
          Email: <span class="demo-email">test@example.com</span><br />
          Password: <span class="demo-pass">brownPass123</span><br />
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

  var demoDivs = root.querySelectorAll(".demo-account");
  demoDivs.forEach(function (div) {
    div.addEventListener("click", function (e) {
      if (!e.target.classList.contains("fillDemoBtn")) {
        var btn = this.querySelector(".fillDemoBtn");
        var email = btn.getAttribute("data-email");
        var password = btn.getAttribute("data-password");
        document.getElementById("email").value = email;
        document.getElementById("password").value = password;
        document.getElementById("email").focus();
      }
    });
    div.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        var btn = this.querySelector(".fillDemoBtn");
        var email = btn.getAttribute("data-email");
        var password = btn.getAttribute("data-password");
        document.getElementById("email").value = email;
        document.getElementById("password").value = password;
        document.getElementById("email").focus();
      }
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
