import { supabase } from "./supabase";

export async function sendFriendRequest(
  currentUserId: string,
  currentUsername: string,
  targetUsername: string,
): Promise<{ success: boolean; message: string }> {
  const cleanName = targetUsername.toLowerCase().trim();
  if (!cleanName) {
    return { success: false, message: "Username cannot be empty" };
  }

  if (cleanName === currentUsername.toLowerCase().trim()) {
    return {
      success: false,
      message: "You cannot add yourself",
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

    // Check if friend request already exists
    const { data: existingRequest } = await supabase
      .from("friend_requests")
      .select("id, status, from_user_id")
      .or(
        `and(from_user_id.eq.${currentUserId},to_user_id.eq.${profile.id}),and(from_user_id.eq.${profile.id},to_user_id.eq.${currentUserId})`,
      )
      .maybeSingle();

    if (existingRequest) {
      if (existingRequest.status === "pending") {
        if (existingRequest.from_user_id === currentUserId) {
          return { success: false, message: "Friend request already sent." };
        } else {
          return {
            success: false,
            message: "They already sent you a request. Check your Friends tab!",
          };
        }
      } else if (existingRequest.status === "accepted") {
        return { success: false, message: "You are already friends." };
      }
    }

    // Insert friend request
    const { error: insertError } = await supabase
      .from("friend_requests")
      .insert({
        from_user_id: currentUserId,
        to_user_id: profile.id,
        status: "pending",
      });

    if (insertError) throw insertError;

    return {
      success: true,
      message: `Friend request sent to ${profile.username}!`,
    };
  } catch (err: any) {
    console.error("Error sending friend request:", err);
    return {
      success: false,
      message: err.message || "Failed to send friend request",
    };
  }
}

export async function fetchPendingRequests(userId: string) {
  const { data, error } = await supabase
    .from("friend_requests")
    .select(
      `
      id,
      from_user_id,
      created_at,
      profiles!friend_requests_from_user_id_fkey (
        username
      )
    `,
    )
    .eq("to_user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching pending requests:", error);
    return [];
  }
  return data;
}

export async function acceptFriendRequest(
  requestId: string,
  currentUserId: string,
  fromUserId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Update request status
    const { error: updateError } = await supabase
      .from("friend_requests")
      .update({ status: "accepted" })
      .eq("id", requestId);

    if (updateError) throw updateError;

    return { success: true, message: "Friend request accepted!" };
  } catch (err: any) {
    console.error("Error accepting friend request:", err);
    return {
      success: false,
      message: err.message || "Failed to accept request.",
    };
  }
}

export async function rejectFriendRequest(
  requestId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const { error } = await supabase
      .from("friend_requests")
      .update({ status: "rejected" })
      .eq("id", requestId);

    if (error) throw error;
    return { success: true, message: "Friend request rejected." };
  } catch (err: any) {
    console.error("Error rejecting friend request:", err);
    return {
      success: false,
      message: err.message || "Failed to reject request.",
    };
  }
}
