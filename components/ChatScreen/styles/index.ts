import { Platform, StyleSheet } from "react-native";

// Apple HIG system colors
const systemBlue = "#007AFF";
const systemGray6 = "#F2F2F7";
const systemGray5 = "#E5E5EA";
const systemGray4 = "#D1D1D6";
const systemGray3 = "#C7C7CC";
const systemGray = "#8E8E93";
const label = "#000000";
const secondaryLabel = "#3C3C43";

export const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#F9F9F9",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: systemGray4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    marginRight: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  backButtonText: {
    color: systemBlue,
    fontSize: 17,
    fontWeight: "400",
    letterSpacing: -0.41,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: label,
    letterSpacing: -0.41,
  },
  headerSubtitle: {
    fontSize: 12,
    color: systemGray,
    marginTop: 1,
    letterSpacing: 0,
  },
  signOutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  signOutBtnText: {
    color: "#FF3B30",
    fontSize: 15,
    fontWeight: "400",
    letterSpacing: -0.24,
  },
  contactsList: {
    flex: 1,
  },
  contactsHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: systemGray6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  contactsTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: systemGray,
    textTransform: "uppercase",
    letterSpacing: -0.08,
  },
  addContactBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: systemBlue,
    justifyContent: "center",
    alignItems: "center",
  },
  addContactBtnText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "400",
    lineHeight: 22,
  },
  contactItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: systemGray5,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: systemGray6,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  contactAvatarText: {
    fontSize: 17,
    fontWeight: "600",
    color: systemBlue,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 17,
    fontWeight: "400",
    color: label,
    letterSpacing: -0.41,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyStateText: {
    color: systemGray,
    fontSize: 15,
    textAlign: "center",
    marginTop: 12,
    letterSpacing: -0.24,
  },
  chatWrapper: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  messageList: {
    padding: 16,
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
    maxWidth: "75%",
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
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.41,
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
    color: "rgba(255,255,255,0.65)",
  },
  timeTextOther: {
    color: systemGray,
  },
  inputContainer: {
    padding: 8,
    paddingBottom: Platform.OS === "ios" ? 20 : 8,
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
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 17,
    color: label,
    maxHeight: 100,
    letterSpacing: -0.41,
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
