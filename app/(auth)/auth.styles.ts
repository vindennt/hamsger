import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
    gap: 16,
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#000",
  },
  subtitle: {
    fontSize: 14,
    color: "#8e8e93",
    marginTop: -8,
  },
  fields: {
    gap: 10,
  },
  btn: {
    backgroundColor: "#007aff",
    borderRadius: 12,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  link: {
    textAlign: "center",
    fontSize: 14,
    color: "#8e8e93",
  },
  linkBlue: {
    color: "#007aff",
    fontWeight: "600",
  },
});

export const fieldStyles = StyleSheet.create({
  wrap: {
    backgroundColor: "#f2f2f7",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  wrapFocused: {
    borderColor: "#007aff",
    backgroundColor: "#fff",
  },
  input: {
    height: 48,
    paddingHorizontal: 14,
    fontSize: 16,
    color: "#000",
  },
});
