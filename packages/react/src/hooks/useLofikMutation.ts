import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils";
import { UseMutationOptions, useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { sqlocal } from "../db/sqlocal";
import {
  DatabaseMutationOperation,
  GenerateDatabaseMutation,
  Message,
} from "../types";
import { getUnixTimestamp } from "../utils/dates";
import { utils } from "../utils/db";
import { useAccountContext, useWebsocketContext } from "./contexts";

type Params = Omit<
  UseMutationOptions<
    unknown,
    Error,
    GenerateDatabaseMutation | GenerateDatabaseMutation[],
    unknown
  >,
  "mutationFn"
> & { shouldSync: boolean; isFullSync?: boolean };

export const useLofikMutation = ({
  shouldSync,
  isFullSync = false,
  ...options
}: Params) => {
  const { sync } = useServerSync();

  const mutate = useCallback(
    async (mutation: GenerateDatabaseMutation | GenerateDatabaseMutation[]) => {
      const ts = getUnixTimestamp();

      const mutations = Array.isArray(mutation) ? mutation : [mutation];

      for (const mutation of mutations) {
        const sql = utils[mutation.operation](mutation, ts);

        await sqlocal.sql(sql);
      }

      if (shouldSync) {
        sync(mutations, ts, isFullSync);
      }
    },
    [shouldSync, sync, isFullSync]
  );

  return useMutation({ ...options, mutationFn: mutate });
};

const useServerSync = () => {
  const { privKey, pubKeyHex, deviceId } = useAccountContext();
  const { socket } = useWebsocketContext();

  const sync = useCallback(
    async (
      mutations: GenerateDatabaseMutation[],
      ts: number,
      isFullSync: boolean
    ) => {
      const nonce = randomBytes(24);

      const chacha = xchacha20poly1305(sha256(privKey), nonce);

      const messages: Message[] = [];

      for (const mutation of mutations) {
        const encryptedMutation = chacha.encrypt(
          utf8ToBytes(JSON.stringify(mutation))
        );

        messages.push({
          pubKeyHex,
          payload: bytesToHex(encryptedMutation),
          nonce: bytesToHex(nonce),
          deviceId,
          ts,
        });
      }

      try {
        await socket
          ?.timeout(10000)
          .emitWithAck(
            isFullSync ? "messages-full-sync" : "messages",
            messages
          );
      } catch (err) {
        console.error(err);

        if (isFullSync) {
          return;
        }

        const sql = utils.Upsert(
          {
            operation: DatabaseMutationOperation.Upsert,
            tableName: "pendingUpdates",
            columnDataMap: {
              message: JSON.stringify(messages),
              createdAt: getUnixTimestamp(),
            },
          },
          ts
        );

        await sqlocal.sql(sql);
      }
    },
    [privKey, pubKeyHex, socket, deviceId]
  );

  return useMemo(() => ({ sync }), [sync]);
};
