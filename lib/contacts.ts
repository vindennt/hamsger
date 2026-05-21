import { supabase } from "./supabase";

/**
 * Adds a contact by searching for their username in Supabase profiles,
 * checking if they are already added, and creating the contact record.
 */
export async function addContact(
  currentUserId: string,
  currentUsername: string,
  friendUsername: string,
): Promise<{ success: boolean; message: string }> {
  const cleanName = friendUsername.toLowerCase().trim();
  if (!cleanName) {
    return { success: false, message: "Username cannot be empty" };
  }

  if (cleanName === currentUsername.toLowerCase().trim()) {
    return {
      success: false,
      message: "You cannot add yourself as a contact",
    };
  }

  try {
    // Find friend profile
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("username", cleanName)
      .maybeSingle();

    if (error || !profile) {
      return { success: false, message: `User "${cleanName}" not found.` };
    }

    // Check if already in contacts
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id")
      .eq("user_id", currentUserId)
      .eq("contact_user_id", profile.id)
      .maybeSingle();

    if (existingContact) {
      return {
        success: false,
        message: `${profile.username} is already added.`,
      };
    }

    // Add to contacts
    const { error: insertError } = await supabase.from("contacts").insert({
      user_id: currentUserId,
      contact_user_id: profile.id,
    });

    if (insertError) throw insertError;

    return {
      success: true,
      message: `Successfully added ${profile.username}`,
    };
  } catch (err: any) {
    console.error("Error adding contact:", err);
    return {
      success: false,
      message: err.message || "Failed to add contact",
    };
  }
}
