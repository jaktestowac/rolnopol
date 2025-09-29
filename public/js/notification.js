let notificationCount = 0;
const maxNotifications = 3;

function showNotification(message, type = "error", duration = 6000) {
  const container =
    document.querySelector(".notifications-container") ||
    createNotificationContainer();
  const notification = createNotificationElement(message, type);

  // Remove oldest notification if we exceed max
  if (container.children.length >= maxNotifications) {
    container.removeChild(container.firstChild);
  }

  container.appendChild(notification);
  notification.style.display = "block";

  setTimeout(() => {
    notification.style.animation = "slideOut 0.5s forwards";
    setTimeout(() => {
      notification.remove();
      if (container.children.length === 0) {
        container.remove();
      }
    }, 500);
  }, duration);
}

function createNotificationContainer() {
  const container = document.createElement("div");
  container.className = "notifications-container";
  document.body.appendChild(container);
  return container;
}

function createNotificationElement(message, type) {
  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.innerHTML = message;
  notification.setAttribute("role", "alert");
  notification.setAttribute("aria-live", "polite");
  return notification;
}
