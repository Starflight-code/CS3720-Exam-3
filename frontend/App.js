import React, { useEffect, useRef, useState } from "react";
import { TouchableOpacity, View, Text, Image, TextInput, Modal, Button, FlatList, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";

//  IMPORTANT: adjust this address based on how you run it
// For Android emulator: ws://10.0.2.2:8089/ws
// For same machine (web preview): ws://localhost:8089/ws
// For real device: ws://YOUR_LOCAL_IP:8089/ws
const BACKEND_HTTP = "https://cs3720-exam-3.onrender.com";
const BACKEND_WS = "wss://cs3720-exam-3.onrender.com/ws";

export default function App() {
  // --- WebSocket & Chat state ---
  const socketRef = useRef(null);
  const [messages, setMessages] = useState([]); // {type, author, text, timestamp, url}
  const [inputText, setInputText] = useState("");
  const [author] = useState("Device"); // or ask the user for a name
  // --- Shared photo state ---
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState(null);
  // --- Photo list (for browsing from backend) ---
  const [photos, setPhotos] = useState([]); // [{ filename, url }]
  const [browseModalVisible, setBrowseModalVisible] = useState(false);
  // --- Camera state ---
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  const cameraRef = useRef(null);

  // =============================
  //      WEBSOCKET HANDLING
  // =============================
  useEffect(() => {
    console.log("Connecting to WS:", BACKEND_WS);
    const socket = new WebSocket(BACKEND_WS);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connected");
    };

    socket.onmessage = (event) => {
      console.log(" WebSocket message:", event.data);
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "photo_select") {
          // Update shared image at the top
          if (msg.url) {
            setCurrentPhotoUrl(msg.url);
          }
          // Also add a "system" message in chat if you want
          setMessages((prev) => [
            ...prev,
            {
              type: "system",
              text: `${msg.author || "Someone"} selected a new photo`,
              timestamp: msg.timestamp,
            },
          ]);
        } else if (msg.type === "text") {
          setMessages((prev) => [...prev, msg]);
        } else {
          // Unknown type - just show raw
          setMessages((prev) => [...prev, msg]);
        }
      } catch (err) {
        console.log("Error parsing incoming message:", err);
      }
    };

    socket.onerror = (err) => {
      console.log("WebSocket error:", err.message || err);
    };

    socket.onclose = (event) => {
      console.log(" WebSocket closed:", event.code, event.reason);
    };

    return () => {
      socket.close();
    };
  }, []);

  const sendTextMessage = () => {
    const trimmed = inputText.trim();
    if (!trimmed || !socketRef.current || socketRef.current.readyState !== 1) {
      return;
    }

    const msg = {
      type: "text",
      author,
      text: trimmed,
      timestamp: new Date().toISOString(),
    };

    socketRef.current.send(JSON.stringify(msg));
    setInputText("");
  };

  const broadcastPhotoSelection = (fullUrl) => {
    if (!socketRef.current || socketRef.current.readyState !== 1) return;

    const msg = {
      type: "photo_select",
      author,
      url: fullUrl,
      timestamp: new Date().toISOString(),
    };

    socketRef.current.send(JSON.stringify(msg));
  };

  // =============================
  //         CAMERA LOGIC
  // =============================
  const openCamera = async () => {
    if (!cameraPermission) {
      await requestCameraPermission();
      return;
    }

    if (!cameraPermission.granted) {
      const status = await requestCameraPermission();
      if (!status.granted) {
        Alert.alert(
          "Permission required",
          "Camera permission is needed to take photos."
        );
        return;
      }
    }

    setCameraModalVisible(true);
  };

  const takePictureAndUpload = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync();
      console.log("Photo taken:", photo.uri);

      // Prepare form data
      const formData = new FormData();
      formData.append("file", {
        uri: photo.uri,
        name: `photo-${Date.now()}.jpg`,
        type: "image/jpeg",
      });

      console.log(" Uploading to:", `${BACKEND_HTTP}/upload-photo`);

      // IMPORTANT: do NOT set Content-Type manually; let RN set boundary
      const res = await fetch(`${BACKEND_HTTP}/upload-photo`, {
        method: "POST",
        body: formData,
      });

      console.log(" Upload response status:", res.status);
      const textBody = await res.text();
      console.log(" Raw response body:", textBody);

      if (!res.ok) {
        const text = await res.text();
        console.log("Upload failed:", res.status, text);
        Alert.alert("Upload failed", `Status: ${res.status}`);
        return;
      }

      let json;
      try {
        json = JSON.parse(textBody);
      } catch (e) {
        console.log("Error parsing JSON:", e);
        Alert.alert("Error", "Could not parse server response.");
        return;
      }

      console.log(" Parsed JSON:", json);

      if (!json.url) {
        Alert.alert("Error", "Server did not return a URL.");
        return;
      }

      // Build full URL to the photo
      const fullUrl = `${BACKEND_HTTP}${json.url}`;
      console.log(" Full photo URL:", fullUrl);

      // Immediately broadcast selection so all clients show it
      broadcastPhotoSelection(fullUrl);

      // Also update current photo locally
      setCurrentPhotoUrl(fullUrl);

      // Close camera modal
      setCameraModalVisible(false);
    } catch (err) {
      console.error("Error taking/uploading photo:", err);
      Alert.alert("Error", "Could not take or upload photo.");
    }
  };

  // =============================
  //        BROWSE PHOTOS
  // =============================
  const openBrowsePhotos = async () => {
    try {
      const res = await fetch(`${BACKEND_HTTP}/photos`);
      if (!res.ok) {
        const text = await res.text();
        console.log("Error fetching photos:", res.status, text);
        Alert.alert("Error", "Could not fetch photos");
        return;
      }

      const json = await res.json();
      // json.photos is [{ filename, url }]
      setPhotos(json.photos || []);
      setBrowseModalVisible(true);
    } catch (err) {
      console.error("Error fetching photos:", err);
      Alert.alert("Error", "Could not fetch photos");
    }
  };

  const handleSelectPhotoFromList = (photo) => {
    const fullUrl = `${BACKEND_HTTP}${photo.url}`;
    setCurrentPhotoUrl(fullUrl);
    broadcastPhotoSelection(fullUrl);
    setBrowseModalVisible(false);
  };

  // =============================
  //           RENDER
  // =============================
  const renderMessageItem = ({ item }) => {
    if (item.type === "system") {
      return (
        <Text style={styles.systemMessage}>
          {item.text}
        </Text>
      );
    }

    if (item.type === "text") {
      return (
        <View style={styles.messageRow}>
          <Text style={styles.messageAuthor}>{item.author || "User"}:</Text>
          <Text style={styles.messageText}>{item.text}</Text>
        </View>
      );
    }

    // fallback
    return <Text style={styles.messageText}>{JSON.stringify(item)}</Text>;
  };

  const renderPhotoItem = ({ item }) => {
    const fullUrl = `${BACKEND_HTTP}${item.url}`;
    return (
      <TouchableOpacity
        style={styles.photoItem}
        onPress={() => handleSelectPhotoFromList(item)}
      >
        <Image
          source={{ uri: fullUrl }}
          style={styles.photoThumbnail}
          resizeMode="cover"
        />
        <Text style={styles.photoName}>{item.filename}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* TOP: Shared photo */}
        <View style={styles.photoContainer}>
          {currentPhotoUrl ? (
            <Image
              source={{ uri: currentPhotoUrl }}
              style={styles.sharedPhoto}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.noPhoto}>
              <Text style={styles.noPhotoText}>No photo selected</Text>
            </View>
          )}
        </View>

        {/* MIDDLE: Chat messages */}
        <View style={styles.chatContainer}>
          <FlatList
            data={messages}
            keyExtractor={(_, index) => index.toString()}
            renderItem={renderMessageItem}
          />
        </View>

        {/* BOTTOM: Input + buttons */}
        <View style={styles.bottomBar}>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={openCamera}>
              <Text style={styles.buttonText}>Take Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.button} onPress={openBrowsePhotos}>
              <Text style={styles.buttonText}>Browse Photos</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Type a message..."
            />
            <TouchableOpacity style={styles.sendButton} onPress={sendTextMessage}>
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* CAMERA MODAL */}
        <Modal visible={cameraModalVisible} animationType="slide">
          <View style={styles.cameraModal}>
            <CameraView
              ref={cameraRef}
              style={styles.cameraView}
              facing="back"
            />
            <View style={styles.cameraControls}>
              <TouchableOpacity
                style={styles.cameraButton}
                onPress={takePictureAndUpload}
              >
                <Text style={styles.cameraButtonText}>Capture & Upload</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.cameraButton, styles.cameraCancel]}
                onPress={() => setCameraModalVisible(false)}
              >
                <Text style={styles.cameraButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* BROWSE PHOTOS MODAL */}
        <Modal visible={browseModalVisible} animationType="slide">
          <SafeAreaView style={styles.browseModal}>
            <Text style={styles.modalTitle}>Select a photo</Text>
            <FlatList
              data={photos}
              keyExtractor={(item) => item.filename}
              renderItem={renderPhotoItem}
              numColumns={2}
              contentContainerStyle={styles.photosGrid}
            />
            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => setBrowseModalVisible(false)}
            >
              <Text style={styles.closeModalText}>Close</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}


// =============================
//           STYLES
// =============================
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#101010",
  },
  container: {
    flex: 1,
    backgroundColor: "#101010",
  },
  photoContainer: {
    flex: 3,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  sharedPhoto: {
    width: "100%",
    height: "100%",
  },
  noPhoto: {
    justifyContent: "center",
    alignItems: "center",
  },
  noPhotoText: {
    color: "#888",
    fontSize: 16,
  },
  chatContainer: {
    flex: 3,
    padding: 8,
  },
  messageRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  messageAuthor: {
    fontWeight: "bold",
    color: "#fff",
    marginRight: 4,
  },
  messageText: {
    color: "#eee",
  },
  systemMessage: {
    fontStyle: "italic",
    color: "#9acd32",
    marginBottom: 4,
  },
  bottomBar: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  button: {
    flex: 1,
    backgroundColor: "#444",
    padding: 10,
    marginHorizontal: 4,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: "#222",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  sendButton: {
    backgroundColor: "#1e90ff",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sendButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  cameraModal: {
    flex: 1,
    backgroundColor: "#000",
  },
  cameraView: {
    flex: 1,
  },
  cameraControls: {
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#000",
  },
  cameraButton: {
    backgroundColor: "#1e90ff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  cameraCancel: {
    backgroundColor: "#555",
  },
  cameraButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  browseModal: {
    flex: 1,
    backgroundColor: "#101010",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
    marginVertical: 10,
  },
  photosGrid: {
    paddingHorizontal: 8,
  },
  photoItem: {
    flex: 1,
    margin: 6,
    alignItems: "center",
  },
  photoThumbnail: {
    width: 140,
    height: 140,
    borderRadius: 8,
    marginBottom: 4,
  },
  photoName: {
    color: "#ddd",
    fontSize: 12,
    textAlign: "center",
  },
  closeModalButton: {
    backgroundColor: "#444",
    padding: 12,
    margin: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  closeModalText: {
    color: "#fff",
    fontWeight: "600",
  },
});

