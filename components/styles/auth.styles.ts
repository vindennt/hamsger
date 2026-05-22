import { Platform, StyleSheet } from "react-native";

// Apple HIG color tokens
const systemBlue = "#007AFF";
const systemGray6 = "#F2F2F7";
const systemGray5 = "#E5E5EA";
const systemGray3 = "#C7C7CC";
const systemGray = "#8E8E93";
const label = "#000000";
const secondaryLabel = "#3C3C43";

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: systemGray6,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 28,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }
      : {
          shadowColor: "#000",
          shadowOpacity: 0.04,
          shadowOffset: { width: 0, height: 1 },
          shadowRadius: 3,
        }),
    elevation: 1,
    gap: 20,
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: label,
    letterSpacing: 0.35,
  },
  subtitle: {
    fontSize: 15,
    color: systemGray,
    marginTop: -10,
    letterSpacing: -0.24,
  },
  fields: {
    gap: 12,
  },
  btn: {
    backgroundColor: systemBlue,
    borderRadius: 12,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.41,
  },
  link: {
    textAlign: "center",
    fontSize: 15,
    color: systemGray,
    letterSpacing: -0.24,
  },
  linkBlue: {
    color: systemBlue,
    fontWeight: "600",
  },
});

export const fieldStyles = StyleSheet.create({
  wrap: {
    backgroundColor: systemGray6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: systemGray5,
  },
  wrapFocused: {
    borderColor: systemBlue,
    backgroundColor: "#ffffff",
  },
  input: {
    height: 48,
    paddingHorizontal: 16,
    fontSize: 17,
    color: label,
    letterSpacing: -0.41,
  },
});
