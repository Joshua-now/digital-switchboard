export function sendSlackMessage(message) {
  console.log("Slack message:", message);
}

export function notifyLeadCreated(lead) {
  console.log("Slack lead notification:", lead);
}

export function notifyCallStarted(call) {
  console.log("Slack call started:", call);
}

export function notifyCallCompleted(call) {
  console.log("Slack call completed:", call);
}