import { StyleSheet } from "react-native";

// Apple HIG system colors
const systemBlue = "#007AFF";
const systemGray6 = "#F2F2F7";
const systemGray5 = "#E5E5EA";
const systemGray4 = "#D1D1D6";
const systemGray = "#8E8E93";
const label = "#000000";
const secondaryLabel = "#3C3C43";

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: systemGray6,
  },
  container: {
    flex: 1,
    flexDirection: "row",
    width: "100%",
    maxWidth: 1080,
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: systemGray4,
  },
  sidebar: {
    width: 300,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: systemGray4,
    backgroundColor: "#F9F9F9",
  },
  sidebarHeader: {
    padding: 16,
    paddingTop: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: systemGray4,
  },
  sidebarTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: label,
    letterSpacing: -0.41,
  },
  signOutBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
  },
  signOutBtnText: {
    color: "#FF3B30",
    fontSize: 15,
    fontWeight: "400",
    letterSpacing: -0.24,
  },
  contactsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  contactsTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: systemGray,
    textTransform: "uppercase",
    letterSpacing: -0.08,
  },
  addContactBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: systemBlue,
    justifyContent: "center",
    alignItems: "center",
  },
  addContactBtnText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "300",
    lineHeight: 20,
  },
  contactItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: systemGray5,
  },
  contactItemActive: {
    backgroundColor: systemBlue,
  },
  contactName: {
    fontSize: 17,
    fontWeight: "400",
    color: label,
    letterSpacing: -0.41,
  },
  contactNameActive: {
    color: "#ffffff",
    fontWeight: "500",
  },
  mainPane: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  chatHeader: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: systemGray4,
    backgroundColor: "#F9F9F9",
    flexDirection: "row",
    alignItems: "center",
  },
  chatHeaderTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: label,
    letterSpacing: -0.41,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 15,
    color: systemGray,
    letterSpacing: -0.24,
  },
  chatWrapper: {
    flex: 1,
  },
  messageList: {
    padding: 20,
    paddingBottom: 8,
  },
  messageRow: {
    flexDirection: "row",
    marginBottom: 4,
    alignItems: "flex-end",
  },
  messageRowMe: {
    justifyContent: "flex-end",
  },
  messageRowOther: {
    justifyContent: "flex-start",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: systemGray5,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  avatarText: {
    color: secondaryLabel,
    fontWeight: "600",
    fontSize: 12,
  },
  bubble: {
    maxWidth: "65%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
  },
  bubbleMe: {
    backgroundColor: systemBlue,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: systemGray6,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.24,
  },
  messageTextMe: {
    color: "#ffffff",
  },
  messageTextOther: {
    color: label,
  },
  timeText: {
    fontSize: 11,
    marginTop: 2,
    alignSelf: "flex-end",
  },
  timeTextMe: {
    color: "rgba(255,255,255,0.6)",
  },
  timeTextOther: {
    color: systemGray,
  },
  inputContainer: {
    width: "100%",
    padding: 12,
    backgroundColor: "#F9F9F9",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: systemGray4,
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: systemGray4,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: label,
    maxHeight: 120,
    outlineStyle: "none" as any,
    letterSpacing: -0.24,
  },
  sendButton: {
    marginLeft: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: systemBlue,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 15,
  },
});
