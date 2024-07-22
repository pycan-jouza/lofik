import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { bytesToUtf8, hexToBytes } from "@noble/ciphers/utils";
import { sha256 } from "@noble/hashes/sha256";
import { ReactNode, createContext, useEffect, useState } from "react";
import { Socket, io } from "socket.io-client";
import { useAccountContext } from "../hooks/contexts";
import { useLofikQueryClient } from "../hooks/useLofikQueryClient";
import { handleRemoteDatabaseMutation, pushPendingUpdates } from "../utils/db";
import { generateDatabaseMutationSchema } from "../validators/db";
import { messagesSchema } from "../validators/messages";

type WebsocketContext = {
  socket?: Socket;
};

export const WebsocketContext = createContext({} as WebsocketContext);

type Props = {
  children: ReactNode;
  websocketServerUrl?: string;
};

export const WebsocketProvider = ({ children, websocketServerUrl }: Props) => {
  const [socket, setSocket] = useState<Socket>();
  const { privKey, pubKeyHex, deviceId } = useAccountContext();
  const queryClient = useLofikQueryClient();

  useEffect(() => {
    if (!websocketServerUrl) {
      console.log("[lofik]: websocketServerUrl not set, syncing disabled..");
      return;
    }

    setSocket(
      io(websocketServerUrl, {
        autoConnect: false,
      })
    );
  }, [websocketServerUrl]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    socket.on("connect", () => pushPendingUpdates(socket));

    if (socket.connected) {
      socket.disconnect();
    }

    socket.auth = { pubKeyHex, deviceId };

    socket.connect();

    return () => {
      socket.off("connect", () => pushPendingUpdates(socket));
    };
  }, [pubKeyHex, deviceId, socket]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onMessages = async (messages: unknown, ack: () => void) => {
      for (const message of messagesSchema.parse(messages)) {
        if (message.deviceId === deviceId) {
          continue;
        }

        const chacha = xchacha20poly1305(
          sha256(privKey),
          hexToBytes(message.nonce)
        );

        const decryptedData = chacha.decrypt(hexToBytes(message.payload));

        const data = JSON.parse(bytesToUtf8(decryptedData));

        const validatedData = generateDatabaseMutationSchema.parse(data);

        await handleRemoteDatabaseMutation({
          ts: message.ts,
          mutation: validatedData,
        });
      }

      ack();

      await queryClient.invalidateQueries();
    };

    socket.on("messages", onMessages);

    return () => {
      socket.off("messages", onMessages);
    };
  }, [privKey, deviceId, queryClient, socket]);

  return (
    <WebsocketContext.Provider value={{ socket } as WebsocketContext}>
      {children}
    </WebsocketContext.Provider>
  );
};
