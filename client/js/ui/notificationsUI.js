// client/js/ui/notificationsUI.js

const notificationsArea = document.getElementById("notifications-area");

/**
 * Displays a message in the notifications area.
 * @param {object} messageObject - { type: 'info/error/game/success', text: '', sender: '' }
 */
export function displayMessage(messageObject) {
  if (!notificationsArea) return;

  const messageEl = document.createElement("p");
  messageEl.classList.add("message", `message-${messageObject.type || "info"}`);

  let prefix = "";
  if (messageObject.type === "error") prefix = "❌ Error: ";
  else if (messageObject.type === "success") prefix = "✅ Success: ";
  else if (messageObject.type === "game" && messageObject.sender) prefix = `[${messageObject.sender}]: `;
  else if (messageObject.type === "info") prefix = "ℹ️ Info: ";

  messageEl.textContent = `${prefix}${messageObject.text}`;
  notificationsArea.appendChild(messageEl);

  // Auto-scroll to the bottom
  notificationsArea.scrollTop = notificationsArea.scrollHeight;

  // Optional: Remove old messages to prevent clutter
  if (notificationsArea.children.length > 20) {
    notificationsArea.removeChild(notificationsArea.firstChild);
  }
}

/**
 * Shows a more prominent, perhaps temporary, notification.
 * For MVP, this can be similar to displayMessage or a browser alert.
 * @param {string} notificationText
 */
export function showNotification(notificationText) {
  // For MVP, let's just use an alert, or style it differently in displayMessage
  // alert(notificationText);
  displayMessage({ type: "info", text: `📢 ${notificationText}` });
}

// No init needed for this module as it only provides functions.
