import { useAuth } from "@/context/auth";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  acceptFriendRequest,
  fetchPendingRequests,
  rejectFriendRequest,
  sendFriendRequest,
} from "../../lib/contacts";
import { styles } from "./friends.styles";

export default function FriendsScreen() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  const currentUsername =
    user?.user_metadata?.username ||
    user?.email?.split("@")[0] ||
    "unauthorized";

  useEffect(() => {
    if (user) {
      loadPendingRequests();
    }
  }, [user]);

  const loadPendingRequests = async () => {
    if (!user) return;
    const requests = await fetchPendingRequests(user.id);
    setPendingRequests(requests);
  };

  const handleSendRequest = async () => {
    if (!user || !searchQuery.trim()) return;
    setLoading(true);
    const res = await sendFriendRequest(user.id, currentUsername, searchQuery);
    setLoading(false);
    if (Platform.OS === "web") {
      alert(res.message);
    } else {
      Alert.alert(res.success ? "Success" : "Error", res.message);
    }
    if (res.success) {
      setSearchQuery("");
    }
  };

  const handleAccept = async (requestId: string, fromUserId: string) => {
    if (!user) return;
    setLoading(true);
    const res = await acceptFriendRequest(requestId, user.id, fromUserId);
    setLoading(false);
    if (res.success) {
      loadPendingRequests();
    } else {
      Platform.OS === "web" ? alert(res.message) : Alert.alert("Error", res.message);
    }
  };

  const handleReject = async (requestId: string) => {
    if (!user) return;
    setLoading(true);
    const res = await rejectFriendRequest(requestId);
    setLoading(false);
    if (res.success) {
      loadPendingRequests();
    } else {
      Platform.OS === "web" ? alert(res.message) : Alert.alert("Error", res.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Friends</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Add Friend</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            placeholder="Enter exact username"
            placeholderTextColor="#8e8e93"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.addButton, loading && { opacity: 0.5 }]}
            onPress={handleSendRequest}
            disabled={loading || !searchQuery.trim()}
          >
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.section, { flex: 1 }]}>
        <Text style={styles.sectionTitle}>Pending Requests</Text>
        {pendingRequests.length === 0 ? (
          <Text style={styles.emptyText}>No pending friend requests.</Text>
        ) : (
          <FlatList
            data={pendingRequests}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.requestRow}>
                <View>
                  <Text style={styles.requestName}>
                    {item.profiles?.username || "Unknown"}
                  </Text>
                  <Text style={styles.requestDate}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.acceptBtn]}
                    onPress={() => handleAccept(item.id, item.from_user_id)}
                  >
                    <Text style={styles.actionBtnText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.rejectBtn]}
                    onPress={() => handleReject(item.id)}
                  >
                    <Text style={styles.actionBtnText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}


