import {
  QueryKey,
  UndefinedInitialDataOptions,
  useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { TypeOf, ZodSchema, optional } from "zod";
import { sqlocal } from "../db/sqlocal";

type Params<T extends ZodSchema> = Omit<
  UndefinedInitialDataOptions<TypeOf<T>, Error, TypeOf<T>, QueryKey>,
  "queryFn"
> & { sql: string; schema: T };

export const useLofikQuery = <T extends ZodSchema>({
  sql,
  schema,
  ...options
}: Params<T>) => {
  const query = useQuery({ ...options, queryFn: () => sqlocal.sql(sql) });

  const validatedData = useMemo(
    () => optional(schema).parse(query.data),
    [query.data, schema]
  );

  return {
    ...query,
    data: validatedData,
  };
};
