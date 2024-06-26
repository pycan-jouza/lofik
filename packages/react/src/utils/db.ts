import { OpfsDatabase } from "@sqlite.org/sqlite-wasm";
import { Remote } from "comlink";
import { Socket } from "socket.io-client";
import { z } from "zod";
import { HLC } from "../contexts/HlcContext";
import {
  DatabaseMutationOperation,
  GenerateDatabaseDelete,
  GenerateDatabaseMutation,
  GenerateDatabaseUpsert,
} from "../types";

export const utils = {
  generateUpsert: (
    {
      tableName,
      columnDataMap,
      identifierColumn = "id",
    }: GenerateDatabaseUpsert,
    hlc: HLC
  ) => {
    const columns = Object.keys(columnDataMap);
    const values = Object.values(columnDataMap);

    const updateClause = columns
      .map((column, i) =>
        values[i] === null ? `${column}=null` : `${column}='${values[i]}'`
      )
      .join(",");

    const sql = `insert into ${tableName} (${columns.join(
      ","
    )}, updatedAt) values (${values
      .map((v) => (v === null ? "null" : `'${v}'`))
      .join(",")},'${
      hlc.ts
    }') on conflict (${identifierColumn}) do update set ${updateClause},updatedAt='${
      hlc.ts
    }';`;

    return sql;
  },
  generateDelete: (
    {
      tableName,
      identifierValue,
      identifierColumn = "id",
    }: GenerateDatabaseDelete,
    hlc: HLC
  ) => {
    const sql = `update ${tableName} set deletedAt = '${hlc.ts}', updatedAt = '${hlc.ts}' where ${identifierColumn} = '${identifierValue}'`;

    return sql;
  },
};

export const handleRemoteDatabaseMutation = async ({
  db,
  hlc,
  mutation,
}: {
  db: Remote<OpfsDatabase>;
  hlc: HLC;
  mutation: GenerateDatabaseMutation;
}) => {
  const identifierColumn = mutation.identifierColumn || "id";
  const identifierValue =
    mutation.operation === DatabaseMutationOperation.Upsert
      ? mutation.columnDataMap[identifierColumn]
      : mutation.identifierValue;

  const record = await db.selectObjects(
    `select * from ${mutation.tableName} where ${identifierColumn} = '${identifierValue}'`
  );

  if (
    record[0] &&
    new Date(z.number().parse(record[0].updatedAt)) >= new Date(hlc.ts)
  ) {
    return;
  }

  const sql =
    mutation.operation === DatabaseMutationOperation.Upsert
      ? utils.generateUpsert(mutation, hlc)
      : utils.generateDelete(mutation, hlc);

  // @ts-expect-error
  await db.exec(sql);
};

export const pushPendingUpdates = async ({
  db,
  socket,
}: {
  db: Remote<OpfsDatabase>;
  socket: Socket;
}) => {
  const pendingUpdates = await db.selectObjects(
    "select * from pendingUpdates order by id"
  );

  if (!pendingUpdates.length) {
    return;
  }

  try {
    await socket.timeout(10000).emitWithAck(
      "messages",
      pendingUpdates.flatMap((update) =>
        JSON.parse(z.string().parse(update.message))
      )
    );

    for (const update of pendingUpdates) {
      // @ts-expect-error
      await db.exec(`delete from pendingUpdates where id = ${update.id}`);
    }
  } catch (err) {
    console.error(err);
  }
};
