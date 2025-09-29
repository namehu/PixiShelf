
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model Artist
 * 
 */
export type Artist = $Result.DefaultSelection<Prisma.$ArtistPayload>
/**
 * Model Artwork
 * 
 */
export type Artwork = $Result.DefaultSelection<Prisma.$ArtworkPayload>
/**
 * Model Tag
 * 
 */
export type Tag = $Result.DefaultSelection<Prisma.$TagPayload>
/**
 * Model ArtworkTag
 * 
 */
export type ArtworkTag = $Result.DefaultSelection<Prisma.$ArtworkTagPayload>
/**
 * Model Image
 * 
 */
export type Image = $Result.DefaultSelection<Prisma.$ImagePayload>
/**
 * Model User
 * 
 */
export type User = $Result.DefaultSelection<Prisma.$UserPayload>
/**
 * Model Setting
 * 
 */
export type Setting = $Result.DefaultSelection<Prisma.$SettingPayload>
/**
 * Model TriggerLog
 * 
 */
export type TriggerLog = $Result.DefaultSelection<Prisma.$TriggerLogPayload>

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Artists
 * const artists = await prisma.artist.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Artists
   * const artists = await prisma.artist.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb, ExtArgs>

      /**
   * `prisma.artist`: Exposes CRUD operations for the **Artist** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Artists
    * const artists = await prisma.artist.findMany()
    * ```
    */
  get artist(): Prisma.ArtistDelegate<ExtArgs>;

  /**
   * `prisma.artwork`: Exposes CRUD operations for the **Artwork** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Artworks
    * const artworks = await prisma.artwork.findMany()
    * ```
    */
  get artwork(): Prisma.ArtworkDelegate<ExtArgs>;

  /**
   * `prisma.tag`: Exposes CRUD operations for the **Tag** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Tags
    * const tags = await prisma.tag.findMany()
    * ```
    */
  get tag(): Prisma.TagDelegate<ExtArgs>;

  /**
   * `prisma.artworkTag`: Exposes CRUD operations for the **ArtworkTag** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more ArtworkTags
    * const artworkTags = await prisma.artworkTag.findMany()
    * ```
    */
  get artworkTag(): Prisma.ArtworkTagDelegate<ExtArgs>;

  /**
   * `prisma.image`: Exposes CRUD operations for the **Image** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Images
    * const images = await prisma.image.findMany()
    * ```
    */
  get image(): Prisma.ImageDelegate<ExtArgs>;

  /**
   * `prisma.user`: Exposes CRUD operations for the **User** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Users
    * const users = await prisma.user.findMany()
    * ```
    */
  get user(): Prisma.UserDelegate<ExtArgs>;

  /**
   * `prisma.setting`: Exposes CRUD operations for the **Setting** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Settings
    * const settings = await prisma.setting.findMany()
    * ```
    */
  get setting(): Prisma.SettingDelegate<ExtArgs>;

  /**
   * `prisma.triggerLog`: Exposes CRUD operations for the **TriggerLog** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TriggerLogs
    * const triggerLogs = await prisma.triggerLog.findMany()
    * ```
    */
  get triggerLog(): Prisma.TriggerLogDelegate<ExtArgs>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 5.22.0
   * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    Artist: 'Artist',
    Artwork: 'Artwork',
    Tag: 'Tag',
    ArtworkTag: 'ArtworkTag',
    Image: 'Image',
    User: 'User',
    Setting: 'Setting',
    TriggerLog: 'TriggerLog'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb extends $Utils.Fn<{extArgs: $Extensions.InternalArgs, clientOptions: PrismaClientOptions }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], this['params']['clientOptions']>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, ClientOptions = {}> = {
    meta: {
      modelProps: "artist" | "artwork" | "tag" | "artworkTag" | "image" | "user" | "setting" | "triggerLog"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Artist: {
        payload: Prisma.$ArtistPayload<ExtArgs>
        fields: Prisma.ArtistFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ArtistFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ArtistFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload>
          }
          findFirst: {
            args: Prisma.ArtistFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ArtistFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload>
          }
          findMany: {
            args: Prisma.ArtistFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload>[]
          }
          create: {
            args: Prisma.ArtistCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload>
          }
          createMany: {
            args: Prisma.ArtistCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ArtistCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload>[]
          }
          delete: {
            args: Prisma.ArtistDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload>
          }
          update: {
            args: Prisma.ArtistUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload>
          }
          deleteMany: {
            args: Prisma.ArtistDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ArtistUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ArtistUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtistPayload>
          }
          aggregate: {
            args: Prisma.ArtistAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateArtist>
          }
          groupBy: {
            args: Prisma.ArtistGroupByArgs<ExtArgs>
            result: $Utils.Optional<ArtistGroupByOutputType>[]
          }
          count: {
            args: Prisma.ArtistCountArgs<ExtArgs>
            result: $Utils.Optional<ArtistCountAggregateOutputType> | number
          }
        }
      }
      Artwork: {
        payload: Prisma.$ArtworkPayload<ExtArgs>
        fields: Prisma.ArtworkFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ArtworkFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ArtworkFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload>
          }
          findFirst: {
            args: Prisma.ArtworkFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ArtworkFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload>
          }
          findMany: {
            args: Prisma.ArtworkFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload>[]
          }
          create: {
            args: Prisma.ArtworkCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload>
          }
          createMany: {
            args: Prisma.ArtworkCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ArtworkCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload>[]
          }
          delete: {
            args: Prisma.ArtworkDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload>
          }
          update: {
            args: Prisma.ArtworkUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload>
          }
          deleteMany: {
            args: Prisma.ArtworkDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ArtworkUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ArtworkUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkPayload>
          }
          aggregate: {
            args: Prisma.ArtworkAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateArtwork>
          }
          groupBy: {
            args: Prisma.ArtworkGroupByArgs<ExtArgs>
            result: $Utils.Optional<ArtworkGroupByOutputType>[]
          }
          count: {
            args: Prisma.ArtworkCountArgs<ExtArgs>
            result: $Utils.Optional<ArtworkCountAggregateOutputType> | number
          }
        }
      }
      Tag: {
        payload: Prisma.$TagPayload<ExtArgs>
        fields: Prisma.TagFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TagFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TagFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload>
          }
          findFirst: {
            args: Prisma.TagFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TagFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload>
          }
          findMany: {
            args: Prisma.TagFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload>[]
          }
          create: {
            args: Prisma.TagCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload>
          }
          createMany: {
            args: Prisma.TagCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TagCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload>[]
          }
          delete: {
            args: Prisma.TagDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload>
          }
          update: {
            args: Prisma.TagUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload>
          }
          deleteMany: {
            args: Prisma.TagDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TagUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TagUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TagPayload>
          }
          aggregate: {
            args: Prisma.TagAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTag>
          }
          groupBy: {
            args: Prisma.TagGroupByArgs<ExtArgs>
            result: $Utils.Optional<TagGroupByOutputType>[]
          }
          count: {
            args: Prisma.TagCountArgs<ExtArgs>
            result: $Utils.Optional<TagCountAggregateOutputType> | number
          }
        }
      }
      ArtworkTag: {
        payload: Prisma.$ArtworkTagPayload<ExtArgs>
        fields: Prisma.ArtworkTagFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ArtworkTagFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ArtworkTagFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload>
          }
          findFirst: {
            args: Prisma.ArtworkTagFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ArtworkTagFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload>
          }
          findMany: {
            args: Prisma.ArtworkTagFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload>[]
          }
          create: {
            args: Prisma.ArtworkTagCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload>
          }
          createMany: {
            args: Prisma.ArtworkTagCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ArtworkTagCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload>[]
          }
          delete: {
            args: Prisma.ArtworkTagDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload>
          }
          update: {
            args: Prisma.ArtworkTagUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload>
          }
          deleteMany: {
            args: Prisma.ArtworkTagDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ArtworkTagUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ArtworkTagUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ArtworkTagPayload>
          }
          aggregate: {
            args: Prisma.ArtworkTagAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateArtworkTag>
          }
          groupBy: {
            args: Prisma.ArtworkTagGroupByArgs<ExtArgs>
            result: $Utils.Optional<ArtworkTagGroupByOutputType>[]
          }
          count: {
            args: Prisma.ArtworkTagCountArgs<ExtArgs>
            result: $Utils.Optional<ArtworkTagCountAggregateOutputType> | number
          }
        }
      }
      Image: {
        payload: Prisma.$ImagePayload<ExtArgs>
        fields: Prisma.ImageFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ImageFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ImageFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload>
          }
          findFirst: {
            args: Prisma.ImageFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ImageFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload>
          }
          findMany: {
            args: Prisma.ImageFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload>[]
          }
          create: {
            args: Prisma.ImageCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload>
          }
          createMany: {
            args: Prisma.ImageCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ImageCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload>[]
          }
          delete: {
            args: Prisma.ImageDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload>
          }
          update: {
            args: Prisma.ImageUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload>
          }
          deleteMany: {
            args: Prisma.ImageDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ImageUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ImageUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ImagePayload>
          }
          aggregate: {
            args: Prisma.ImageAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateImage>
          }
          groupBy: {
            args: Prisma.ImageGroupByArgs<ExtArgs>
            result: $Utils.Optional<ImageGroupByOutputType>[]
          }
          count: {
            args: Prisma.ImageCountArgs<ExtArgs>
            result: $Utils.Optional<ImageCountAggregateOutputType> | number
          }
        }
      }
      User: {
        payload: Prisma.$UserPayload<ExtArgs>
        fields: Prisma.UserFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findFirst: {
            args: Prisma.UserFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findMany: {
            args: Prisma.UserFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          create: {
            args: Prisma.UserCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          createMany: {
            args: Prisma.UserCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.UserCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          delete: {
            args: Prisma.UserDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          update: {
            args: Prisma.UserUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          deleteMany: {
            args: Prisma.UserDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.UserUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.UserUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          aggregate: {
            args: Prisma.UserAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUser>
          }
          groupBy: {
            args: Prisma.UserGroupByArgs<ExtArgs>
            result: $Utils.Optional<UserGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserCountArgs<ExtArgs>
            result: $Utils.Optional<UserCountAggregateOutputType> | number
          }
        }
      }
      Setting: {
        payload: Prisma.$SettingPayload<ExtArgs>
        fields: Prisma.SettingFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SettingFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SettingFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload>
          }
          findFirst: {
            args: Prisma.SettingFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SettingFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload>
          }
          findMany: {
            args: Prisma.SettingFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload>[]
          }
          create: {
            args: Prisma.SettingCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload>
          }
          createMany: {
            args: Prisma.SettingCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SettingCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload>[]
          }
          delete: {
            args: Prisma.SettingDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload>
          }
          update: {
            args: Prisma.SettingUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload>
          }
          deleteMany: {
            args: Prisma.SettingDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SettingUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.SettingUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingPayload>
          }
          aggregate: {
            args: Prisma.SettingAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSetting>
          }
          groupBy: {
            args: Prisma.SettingGroupByArgs<ExtArgs>
            result: $Utils.Optional<SettingGroupByOutputType>[]
          }
          count: {
            args: Prisma.SettingCountArgs<ExtArgs>
            result: $Utils.Optional<SettingCountAggregateOutputType> | number
          }
        }
      }
      TriggerLog: {
        payload: Prisma.$TriggerLogPayload<ExtArgs>
        fields: Prisma.TriggerLogFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TriggerLogFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TriggerLogFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload>
          }
          findFirst: {
            args: Prisma.TriggerLogFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TriggerLogFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload>
          }
          findMany: {
            args: Prisma.TriggerLogFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload>[]
          }
          create: {
            args: Prisma.TriggerLogCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload>
          }
          createMany: {
            args: Prisma.TriggerLogCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TriggerLogCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload>[]
          }
          delete: {
            args: Prisma.TriggerLogDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload>
          }
          update: {
            args: Prisma.TriggerLogUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload>
          }
          deleteMany: {
            args: Prisma.TriggerLogDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TriggerLogUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TriggerLogUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TriggerLogPayload>
          }
          aggregate: {
            args: Prisma.TriggerLogAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTriggerLog>
          }
          groupBy: {
            args: Prisma.TriggerLogGroupByArgs<ExtArgs>
            result: $Utils.Optional<TriggerLogGroupByOutputType>[]
          }
          count: {
            args: Prisma.TriggerLogCountArgs<ExtArgs>
            result: $Utils.Optional<TriggerLogCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
  }


  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type ArtistCountOutputType
   */

  export type ArtistCountOutputType = {
    artworks: number
  }

  export type ArtistCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artworks?: boolean | ArtistCountOutputTypeCountArtworksArgs
  }

  // Custom InputTypes
  /**
   * ArtistCountOutputType without action
   */
  export type ArtistCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtistCountOutputType
     */
    select?: ArtistCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * ArtistCountOutputType without action
   */
  export type ArtistCountOutputTypeCountArtworksArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ArtworkWhereInput
  }


  /**
   * Count Type ArtworkCountOutputType
   */

  export type ArtworkCountOutputType = {
    artworkTags: number
    images: number
  }

  export type ArtworkCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artworkTags?: boolean | ArtworkCountOutputTypeCountArtworkTagsArgs
    images?: boolean | ArtworkCountOutputTypeCountImagesArgs
  }

  // Custom InputTypes
  /**
   * ArtworkCountOutputType without action
   */
  export type ArtworkCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkCountOutputType
     */
    select?: ArtworkCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * ArtworkCountOutputType without action
   */
  export type ArtworkCountOutputTypeCountArtworkTagsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ArtworkTagWhereInput
  }

  /**
   * ArtworkCountOutputType without action
   */
  export type ArtworkCountOutputTypeCountImagesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ImageWhereInput
  }


  /**
   * Count Type TagCountOutputType
   */

  export type TagCountOutputType = {
    artworkTags: number
  }

  export type TagCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artworkTags?: boolean | TagCountOutputTypeCountArtworkTagsArgs
  }

  // Custom InputTypes
  /**
   * TagCountOutputType without action
   */
  export type TagCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TagCountOutputType
     */
    select?: TagCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * TagCountOutputType without action
   */
  export type TagCountOutputTypeCountArtworkTagsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ArtworkTagWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Artist
   */

  export type AggregateArtist = {
    _count: ArtistCountAggregateOutputType | null
    _avg: ArtistAvgAggregateOutputType | null
    _sum: ArtistSumAggregateOutputType | null
    _min: ArtistMinAggregateOutputType | null
    _max: ArtistMaxAggregateOutputType | null
  }

  export type ArtistAvgAggregateOutputType = {
    id: number | null
  }

  export type ArtistSumAggregateOutputType = {
    id: number | null
  }

  export type ArtistMinAggregateOutputType = {
    id: number | null
    name: string | null
    username: string | null
    userId: string | null
    bio: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ArtistMaxAggregateOutputType = {
    id: number | null
    name: string | null
    username: string | null
    userId: string | null
    bio: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ArtistCountAggregateOutputType = {
    id: number
    name: number
    username: number
    userId: number
    bio: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type ArtistAvgAggregateInputType = {
    id?: true
  }

  export type ArtistSumAggregateInputType = {
    id?: true
  }

  export type ArtistMinAggregateInputType = {
    id?: true
    name?: true
    username?: true
    userId?: true
    bio?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ArtistMaxAggregateInputType = {
    id?: true
    name?: true
    username?: true
    userId?: true
    bio?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ArtistCountAggregateInputType = {
    id?: true
    name?: true
    username?: true
    userId?: true
    bio?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type ArtistAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Artist to aggregate.
     */
    where?: ArtistWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Artists to fetch.
     */
    orderBy?: ArtistOrderByWithRelationInput | ArtistOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ArtistWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Artists from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Artists.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Artists
    **/
    _count?: true | ArtistCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ArtistAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ArtistSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ArtistMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ArtistMaxAggregateInputType
  }

  export type GetArtistAggregateType<T extends ArtistAggregateArgs> = {
        [P in keyof T & keyof AggregateArtist]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateArtist[P]>
      : GetScalarType<T[P], AggregateArtist[P]>
  }




  export type ArtistGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ArtistWhereInput
    orderBy?: ArtistOrderByWithAggregationInput | ArtistOrderByWithAggregationInput[]
    by: ArtistScalarFieldEnum[] | ArtistScalarFieldEnum
    having?: ArtistScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ArtistCountAggregateInputType | true
    _avg?: ArtistAvgAggregateInputType
    _sum?: ArtistSumAggregateInputType
    _min?: ArtistMinAggregateInputType
    _max?: ArtistMaxAggregateInputType
  }

  export type ArtistGroupByOutputType = {
    id: number
    name: string
    username: string | null
    userId: string | null
    bio: string | null
    createdAt: Date
    updatedAt: Date
    _count: ArtistCountAggregateOutputType | null
    _avg: ArtistAvgAggregateOutputType | null
    _sum: ArtistSumAggregateOutputType | null
    _min: ArtistMinAggregateOutputType | null
    _max: ArtistMaxAggregateOutputType | null
  }

  type GetArtistGroupByPayload<T extends ArtistGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ArtistGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ArtistGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ArtistGroupByOutputType[P]>
            : GetScalarType<T[P], ArtistGroupByOutputType[P]>
        }
      >
    >


  export type ArtistSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    username?: boolean
    userId?: boolean
    bio?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    artworks?: boolean | Artist$artworksArgs<ExtArgs>
    _count?: boolean | ArtistCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["artist"]>

  export type ArtistSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    username?: boolean
    userId?: boolean
    bio?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["artist"]>

  export type ArtistSelectScalar = {
    id?: boolean
    name?: boolean
    username?: boolean
    userId?: boolean
    bio?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type ArtistInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artworks?: boolean | Artist$artworksArgs<ExtArgs>
    _count?: boolean | ArtistCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type ArtistIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $ArtistPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Artist"
    objects: {
      artworks: Prisma.$ArtworkPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: number
      name: string
      username: string | null
      userId: string | null
      bio: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["artist"]>
    composites: {}
  }

  type ArtistGetPayload<S extends boolean | null | undefined | ArtistDefaultArgs> = $Result.GetResult<Prisma.$ArtistPayload, S>

  type ArtistCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ArtistFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ArtistCountAggregateInputType | true
    }

  export interface ArtistDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Artist'], meta: { name: 'Artist' } }
    /**
     * Find zero or one Artist that matches the filter.
     * @param {ArtistFindUniqueArgs} args - Arguments to find a Artist
     * @example
     * // Get one Artist
     * const artist = await prisma.artist.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ArtistFindUniqueArgs>(args: SelectSubset<T, ArtistFindUniqueArgs<ExtArgs>>): Prisma__ArtistClient<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Artist that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ArtistFindUniqueOrThrowArgs} args - Arguments to find a Artist
     * @example
     * // Get one Artist
     * const artist = await prisma.artist.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ArtistFindUniqueOrThrowArgs>(args: SelectSubset<T, ArtistFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ArtistClient<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Artist that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtistFindFirstArgs} args - Arguments to find a Artist
     * @example
     * // Get one Artist
     * const artist = await prisma.artist.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ArtistFindFirstArgs>(args?: SelectSubset<T, ArtistFindFirstArgs<ExtArgs>>): Prisma__ArtistClient<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Artist that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtistFindFirstOrThrowArgs} args - Arguments to find a Artist
     * @example
     * // Get one Artist
     * const artist = await prisma.artist.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ArtistFindFirstOrThrowArgs>(args?: SelectSubset<T, ArtistFindFirstOrThrowArgs<ExtArgs>>): Prisma__ArtistClient<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Artists that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtistFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Artists
     * const artists = await prisma.artist.findMany()
     * 
     * // Get first 10 Artists
     * const artists = await prisma.artist.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const artistWithIdOnly = await prisma.artist.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ArtistFindManyArgs>(args?: SelectSubset<T, ArtistFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Artist.
     * @param {ArtistCreateArgs} args - Arguments to create a Artist.
     * @example
     * // Create one Artist
     * const Artist = await prisma.artist.create({
     *   data: {
     *     // ... data to create a Artist
     *   }
     * })
     * 
     */
    create<T extends ArtistCreateArgs>(args: SelectSubset<T, ArtistCreateArgs<ExtArgs>>): Prisma__ArtistClient<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Artists.
     * @param {ArtistCreateManyArgs} args - Arguments to create many Artists.
     * @example
     * // Create many Artists
     * const artist = await prisma.artist.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ArtistCreateManyArgs>(args?: SelectSubset<T, ArtistCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Artists and returns the data saved in the database.
     * @param {ArtistCreateManyAndReturnArgs} args - Arguments to create many Artists.
     * @example
     * // Create many Artists
     * const artist = await prisma.artist.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Artists and only return the `id`
     * const artistWithIdOnly = await prisma.artist.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ArtistCreateManyAndReturnArgs>(args?: SelectSubset<T, ArtistCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Artist.
     * @param {ArtistDeleteArgs} args - Arguments to delete one Artist.
     * @example
     * // Delete one Artist
     * const Artist = await prisma.artist.delete({
     *   where: {
     *     // ... filter to delete one Artist
     *   }
     * })
     * 
     */
    delete<T extends ArtistDeleteArgs>(args: SelectSubset<T, ArtistDeleteArgs<ExtArgs>>): Prisma__ArtistClient<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Artist.
     * @param {ArtistUpdateArgs} args - Arguments to update one Artist.
     * @example
     * // Update one Artist
     * const artist = await prisma.artist.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ArtistUpdateArgs>(args: SelectSubset<T, ArtistUpdateArgs<ExtArgs>>): Prisma__ArtistClient<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Artists.
     * @param {ArtistDeleteManyArgs} args - Arguments to filter Artists to delete.
     * @example
     * // Delete a few Artists
     * const { count } = await prisma.artist.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ArtistDeleteManyArgs>(args?: SelectSubset<T, ArtistDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Artists.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtistUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Artists
     * const artist = await prisma.artist.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ArtistUpdateManyArgs>(args: SelectSubset<T, ArtistUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Artist.
     * @param {ArtistUpsertArgs} args - Arguments to update or create a Artist.
     * @example
     * // Update or create a Artist
     * const artist = await prisma.artist.upsert({
     *   create: {
     *     // ... data to create a Artist
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Artist we want to update
     *   }
     * })
     */
    upsert<T extends ArtistUpsertArgs>(args: SelectSubset<T, ArtistUpsertArgs<ExtArgs>>): Prisma__ArtistClient<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Artists.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtistCountArgs} args - Arguments to filter Artists to count.
     * @example
     * // Count the number of Artists
     * const count = await prisma.artist.count({
     *   where: {
     *     // ... the filter for the Artists we want to count
     *   }
     * })
    **/
    count<T extends ArtistCountArgs>(
      args?: Subset<T, ArtistCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ArtistCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Artist.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtistAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ArtistAggregateArgs>(args: Subset<T, ArtistAggregateArgs>): Prisma.PrismaPromise<GetArtistAggregateType<T>>

    /**
     * Group by Artist.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtistGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ArtistGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ArtistGroupByArgs['orderBy'] }
        : { orderBy?: ArtistGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ArtistGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetArtistGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Artist model
   */
  readonly fields: ArtistFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Artist.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ArtistClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    artworks<T extends Artist$artworksArgs<ExtArgs> = {}>(args?: Subset<T, Artist$artworksArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Artist model
   */ 
  interface ArtistFieldRefs {
    readonly id: FieldRef<"Artist", 'Int'>
    readonly name: FieldRef<"Artist", 'String'>
    readonly username: FieldRef<"Artist", 'String'>
    readonly userId: FieldRef<"Artist", 'String'>
    readonly bio: FieldRef<"Artist", 'String'>
    readonly createdAt: FieldRef<"Artist", 'DateTime'>
    readonly updatedAt: FieldRef<"Artist", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Artist findUnique
   */
  export type ArtistFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    /**
     * Filter, which Artist to fetch.
     */
    where: ArtistWhereUniqueInput
  }

  /**
   * Artist findUniqueOrThrow
   */
  export type ArtistFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    /**
     * Filter, which Artist to fetch.
     */
    where: ArtistWhereUniqueInput
  }

  /**
   * Artist findFirst
   */
  export type ArtistFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    /**
     * Filter, which Artist to fetch.
     */
    where?: ArtistWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Artists to fetch.
     */
    orderBy?: ArtistOrderByWithRelationInput | ArtistOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Artists.
     */
    cursor?: ArtistWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Artists from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Artists.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Artists.
     */
    distinct?: ArtistScalarFieldEnum | ArtistScalarFieldEnum[]
  }

  /**
   * Artist findFirstOrThrow
   */
  export type ArtistFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    /**
     * Filter, which Artist to fetch.
     */
    where?: ArtistWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Artists to fetch.
     */
    orderBy?: ArtistOrderByWithRelationInput | ArtistOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Artists.
     */
    cursor?: ArtistWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Artists from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Artists.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Artists.
     */
    distinct?: ArtistScalarFieldEnum | ArtistScalarFieldEnum[]
  }

  /**
   * Artist findMany
   */
  export type ArtistFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    /**
     * Filter, which Artists to fetch.
     */
    where?: ArtistWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Artists to fetch.
     */
    orderBy?: ArtistOrderByWithRelationInput | ArtistOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Artists.
     */
    cursor?: ArtistWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Artists from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Artists.
     */
    skip?: number
    distinct?: ArtistScalarFieldEnum | ArtistScalarFieldEnum[]
  }

  /**
   * Artist create
   */
  export type ArtistCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    /**
     * The data needed to create a Artist.
     */
    data: XOR<ArtistCreateInput, ArtistUncheckedCreateInput>
  }

  /**
   * Artist createMany
   */
  export type ArtistCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Artists.
     */
    data: ArtistCreateManyInput | ArtistCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Artist createManyAndReturn
   */
  export type ArtistCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Artists.
     */
    data: ArtistCreateManyInput | ArtistCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Artist update
   */
  export type ArtistUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    /**
     * The data needed to update a Artist.
     */
    data: XOR<ArtistUpdateInput, ArtistUncheckedUpdateInput>
    /**
     * Choose, which Artist to update.
     */
    where: ArtistWhereUniqueInput
  }

  /**
   * Artist updateMany
   */
  export type ArtistUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Artists.
     */
    data: XOR<ArtistUpdateManyMutationInput, ArtistUncheckedUpdateManyInput>
    /**
     * Filter which Artists to update
     */
    where?: ArtistWhereInput
  }

  /**
   * Artist upsert
   */
  export type ArtistUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    /**
     * The filter to search for the Artist to update in case it exists.
     */
    where: ArtistWhereUniqueInput
    /**
     * In case the Artist found by the `where` argument doesn't exist, create a new Artist with this data.
     */
    create: XOR<ArtistCreateInput, ArtistUncheckedCreateInput>
    /**
     * In case the Artist was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ArtistUpdateInput, ArtistUncheckedUpdateInput>
  }

  /**
   * Artist delete
   */
  export type ArtistDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    /**
     * Filter which Artist to delete.
     */
    where: ArtistWhereUniqueInput
  }

  /**
   * Artist deleteMany
   */
  export type ArtistDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Artists to delete
     */
    where?: ArtistWhereInput
  }

  /**
   * Artist.artworks
   */
  export type Artist$artworksArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    where?: ArtworkWhereInput
    orderBy?: ArtworkOrderByWithRelationInput | ArtworkOrderByWithRelationInput[]
    cursor?: ArtworkWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ArtworkScalarFieldEnum | ArtworkScalarFieldEnum[]
  }

  /**
   * Artist without action
   */
  export type ArtistDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
  }


  /**
   * Model Artwork
   */

  export type AggregateArtwork = {
    _count: ArtworkCountAggregateOutputType | null
    _avg: ArtworkAvgAggregateOutputType | null
    _sum: ArtworkSumAggregateOutputType | null
    _min: ArtworkMinAggregateOutputType | null
    _max: ArtworkMaxAggregateOutputType | null
  }

  export type ArtworkAvgAggregateOutputType = {
    id: number | null
    artistId: number | null
    descriptionLength: number | null
    imageCount: number | null
    bookmarkCount: number | null
  }

  export type ArtworkSumAggregateOutputType = {
    id: number | null
    artistId: number | null
    descriptionLength: number | null
    imageCount: number | null
    bookmarkCount: number | null
  }

  export type ArtworkMinAggregateOutputType = {
    id: number | null
    title: string | null
    description: string | null
    artistId: number | null
    createdAt: Date | null
    updatedAt: Date | null
    descriptionLength: number | null
    directoryCreatedAt: Date | null
    imageCount: number | null
    bookmarkCount: number | null
    externalId: string | null
    isAiGenerated: boolean | null
    originalUrl: string | null
    size: string | null
    sourceDate: Date | null
    sourceUrl: string | null
    thumbnailUrl: string | null
    xRestrict: string | null
  }

  export type ArtworkMaxAggregateOutputType = {
    id: number | null
    title: string | null
    description: string | null
    artistId: number | null
    createdAt: Date | null
    updatedAt: Date | null
    descriptionLength: number | null
    directoryCreatedAt: Date | null
    imageCount: number | null
    bookmarkCount: number | null
    externalId: string | null
    isAiGenerated: boolean | null
    originalUrl: string | null
    size: string | null
    sourceDate: Date | null
    sourceUrl: string | null
    thumbnailUrl: string | null
    xRestrict: string | null
  }

  export type ArtworkCountAggregateOutputType = {
    id: number
    title: number
    description: number
    artistId: number
    createdAt: number
    updatedAt: number
    descriptionLength: number
    directoryCreatedAt: number
    imageCount: number
    bookmarkCount: number
    externalId: number
    isAiGenerated: number
    originalUrl: number
    size: number
    sourceDate: number
    sourceUrl: number
    thumbnailUrl: number
    xRestrict: number
    _all: number
  }


  export type ArtworkAvgAggregateInputType = {
    id?: true
    artistId?: true
    descriptionLength?: true
    imageCount?: true
    bookmarkCount?: true
  }

  export type ArtworkSumAggregateInputType = {
    id?: true
    artistId?: true
    descriptionLength?: true
    imageCount?: true
    bookmarkCount?: true
  }

  export type ArtworkMinAggregateInputType = {
    id?: true
    title?: true
    description?: true
    artistId?: true
    createdAt?: true
    updatedAt?: true
    descriptionLength?: true
    directoryCreatedAt?: true
    imageCount?: true
    bookmarkCount?: true
    externalId?: true
    isAiGenerated?: true
    originalUrl?: true
    size?: true
    sourceDate?: true
    sourceUrl?: true
    thumbnailUrl?: true
    xRestrict?: true
  }

  export type ArtworkMaxAggregateInputType = {
    id?: true
    title?: true
    description?: true
    artistId?: true
    createdAt?: true
    updatedAt?: true
    descriptionLength?: true
    directoryCreatedAt?: true
    imageCount?: true
    bookmarkCount?: true
    externalId?: true
    isAiGenerated?: true
    originalUrl?: true
    size?: true
    sourceDate?: true
    sourceUrl?: true
    thumbnailUrl?: true
    xRestrict?: true
  }

  export type ArtworkCountAggregateInputType = {
    id?: true
    title?: true
    description?: true
    artistId?: true
    createdAt?: true
    updatedAt?: true
    descriptionLength?: true
    directoryCreatedAt?: true
    imageCount?: true
    bookmarkCount?: true
    externalId?: true
    isAiGenerated?: true
    originalUrl?: true
    size?: true
    sourceDate?: true
    sourceUrl?: true
    thumbnailUrl?: true
    xRestrict?: true
    _all?: true
  }

  export type ArtworkAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Artwork to aggregate.
     */
    where?: ArtworkWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Artworks to fetch.
     */
    orderBy?: ArtworkOrderByWithRelationInput | ArtworkOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ArtworkWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Artworks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Artworks.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Artworks
    **/
    _count?: true | ArtworkCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ArtworkAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ArtworkSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ArtworkMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ArtworkMaxAggregateInputType
  }

  export type GetArtworkAggregateType<T extends ArtworkAggregateArgs> = {
        [P in keyof T & keyof AggregateArtwork]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateArtwork[P]>
      : GetScalarType<T[P], AggregateArtwork[P]>
  }




  export type ArtworkGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ArtworkWhereInput
    orderBy?: ArtworkOrderByWithAggregationInput | ArtworkOrderByWithAggregationInput[]
    by: ArtworkScalarFieldEnum[] | ArtworkScalarFieldEnum
    having?: ArtworkScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ArtworkCountAggregateInputType | true
    _avg?: ArtworkAvgAggregateInputType
    _sum?: ArtworkSumAggregateInputType
    _min?: ArtworkMinAggregateInputType
    _max?: ArtworkMaxAggregateInputType
  }

  export type ArtworkGroupByOutputType = {
    id: number
    title: string
    description: string | null
    artistId: number | null
    createdAt: Date
    updatedAt: Date
    descriptionLength: number
    directoryCreatedAt: Date | null
    imageCount: number
    bookmarkCount: number | null
    externalId: string | null
    isAiGenerated: boolean | null
    originalUrl: string | null
    size: string | null
    sourceDate: Date | null
    sourceUrl: string | null
    thumbnailUrl: string | null
    xRestrict: string | null
    _count: ArtworkCountAggregateOutputType | null
    _avg: ArtworkAvgAggregateOutputType | null
    _sum: ArtworkSumAggregateOutputType | null
    _min: ArtworkMinAggregateOutputType | null
    _max: ArtworkMaxAggregateOutputType | null
  }

  type GetArtworkGroupByPayload<T extends ArtworkGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ArtworkGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ArtworkGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ArtworkGroupByOutputType[P]>
            : GetScalarType<T[P], ArtworkGroupByOutputType[P]>
        }
      >
    >


  export type ArtworkSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    title?: boolean
    description?: boolean
    artistId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    descriptionLength?: boolean
    directoryCreatedAt?: boolean
    imageCount?: boolean
    bookmarkCount?: boolean
    externalId?: boolean
    isAiGenerated?: boolean
    originalUrl?: boolean
    size?: boolean
    sourceDate?: boolean
    sourceUrl?: boolean
    thumbnailUrl?: boolean
    xRestrict?: boolean
    artist?: boolean | Artwork$artistArgs<ExtArgs>
    artworkTags?: boolean | Artwork$artworkTagsArgs<ExtArgs>
    images?: boolean | Artwork$imagesArgs<ExtArgs>
    _count?: boolean | ArtworkCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["artwork"]>

  export type ArtworkSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    title?: boolean
    description?: boolean
    artistId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    descriptionLength?: boolean
    directoryCreatedAt?: boolean
    imageCount?: boolean
    bookmarkCount?: boolean
    externalId?: boolean
    isAiGenerated?: boolean
    originalUrl?: boolean
    size?: boolean
    sourceDate?: boolean
    sourceUrl?: boolean
    thumbnailUrl?: boolean
    xRestrict?: boolean
    artist?: boolean | Artwork$artistArgs<ExtArgs>
  }, ExtArgs["result"]["artwork"]>

  export type ArtworkSelectScalar = {
    id?: boolean
    title?: boolean
    description?: boolean
    artistId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    descriptionLength?: boolean
    directoryCreatedAt?: boolean
    imageCount?: boolean
    bookmarkCount?: boolean
    externalId?: boolean
    isAiGenerated?: boolean
    originalUrl?: boolean
    size?: boolean
    sourceDate?: boolean
    sourceUrl?: boolean
    thumbnailUrl?: boolean
    xRestrict?: boolean
  }

  export type ArtworkInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artist?: boolean | Artwork$artistArgs<ExtArgs>
    artworkTags?: boolean | Artwork$artworkTagsArgs<ExtArgs>
    images?: boolean | Artwork$imagesArgs<ExtArgs>
    _count?: boolean | ArtworkCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type ArtworkIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artist?: boolean | Artwork$artistArgs<ExtArgs>
  }

  export type $ArtworkPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Artwork"
    objects: {
      artist: Prisma.$ArtistPayload<ExtArgs> | null
      artworkTags: Prisma.$ArtworkTagPayload<ExtArgs>[]
      images: Prisma.$ImagePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: number
      title: string
      description: string | null
      artistId: number | null
      createdAt: Date
      updatedAt: Date
      descriptionLength: number
      directoryCreatedAt: Date | null
      imageCount: number
      bookmarkCount: number | null
      externalId: string | null
      isAiGenerated: boolean | null
      originalUrl: string | null
      size: string | null
      sourceDate: Date | null
      sourceUrl: string | null
      thumbnailUrl: string | null
      xRestrict: string | null
    }, ExtArgs["result"]["artwork"]>
    composites: {}
  }

  type ArtworkGetPayload<S extends boolean | null | undefined | ArtworkDefaultArgs> = $Result.GetResult<Prisma.$ArtworkPayload, S>

  type ArtworkCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ArtworkFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ArtworkCountAggregateInputType | true
    }

  export interface ArtworkDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Artwork'], meta: { name: 'Artwork' } }
    /**
     * Find zero or one Artwork that matches the filter.
     * @param {ArtworkFindUniqueArgs} args - Arguments to find a Artwork
     * @example
     * // Get one Artwork
     * const artwork = await prisma.artwork.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ArtworkFindUniqueArgs>(args: SelectSubset<T, ArtworkFindUniqueArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Artwork that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ArtworkFindUniqueOrThrowArgs} args - Arguments to find a Artwork
     * @example
     * // Get one Artwork
     * const artwork = await prisma.artwork.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ArtworkFindUniqueOrThrowArgs>(args: SelectSubset<T, ArtworkFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Artwork that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkFindFirstArgs} args - Arguments to find a Artwork
     * @example
     * // Get one Artwork
     * const artwork = await prisma.artwork.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ArtworkFindFirstArgs>(args?: SelectSubset<T, ArtworkFindFirstArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Artwork that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkFindFirstOrThrowArgs} args - Arguments to find a Artwork
     * @example
     * // Get one Artwork
     * const artwork = await prisma.artwork.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ArtworkFindFirstOrThrowArgs>(args?: SelectSubset<T, ArtworkFindFirstOrThrowArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Artworks that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Artworks
     * const artworks = await prisma.artwork.findMany()
     * 
     * // Get first 10 Artworks
     * const artworks = await prisma.artwork.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const artworkWithIdOnly = await prisma.artwork.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ArtworkFindManyArgs>(args?: SelectSubset<T, ArtworkFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Artwork.
     * @param {ArtworkCreateArgs} args - Arguments to create a Artwork.
     * @example
     * // Create one Artwork
     * const Artwork = await prisma.artwork.create({
     *   data: {
     *     // ... data to create a Artwork
     *   }
     * })
     * 
     */
    create<T extends ArtworkCreateArgs>(args: SelectSubset<T, ArtworkCreateArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Artworks.
     * @param {ArtworkCreateManyArgs} args - Arguments to create many Artworks.
     * @example
     * // Create many Artworks
     * const artwork = await prisma.artwork.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ArtworkCreateManyArgs>(args?: SelectSubset<T, ArtworkCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Artworks and returns the data saved in the database.
     * @param {ArtworkCreateManyAndReturnArgs} args - Arguments to create many Artworks.
     * @example
     * // Create many Artworks
     * const artwork = await prisma.artwork.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Artworks and only return the `id`
     * const artworkWithIdOnly = await prisma.artwork.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ArtworkCreateManyAndReturnArgs>(args?: SelectSubset<T, ArtworkCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Artwork.
     * @param {ArtworkDeleteArgs} args - Arguments to delete one Artwork.
     * @example
     * // Delete one Artwork
     * const Artwork = await prisma.artwork.delete({
     *   where: {
     *     // ... filter to delete one Artwork
     *   }
     * })
     * 
     */
    delete<T extends ArtworkDeleteArgs>(args: SelectSubset<T, ArtworkDeleteArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Artwork.
     * @param {ArtworkUpdateArgs} args - Arguments to update one Artwork.
     * @example
     * // Update one Artwork
     * const artwork = await prisma.artwork.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ArtworkUpdateArgs>(args: SelectSubset<T, ArtworkUpdateArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Artworks.
     * @param {ArtworkDeleteManyArgs} args - Arguments to filter Artworks to delete.
     * @example
     * // Delete a few Artworks
     * const { count } = await prisma.artwork.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ArtworkDeleteManyArgs>(args?: SelectSubset<T, ArtworkDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Artworks.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Artworks
     * const artwork = await prisma.artwork.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ArtworkUpdateManyArgs>(args: SelectSubset<T, ArtworkUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Artwork.
     * @param {ArtworkUpsertArgs} args - Arguments to update or create a Artwork.
     * @example
     * // Update or create a Artwork
     * const artwork = await prisma.artwork.upsert({
     *   create: {
     *     // ... data to create a Artwork
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Artwork we want to update
     *   }
     * })
     */
    upsert<T extends ArtworkUpsertArgs>(args: SelectSubset<T, ArtworkUpsertArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Artworks.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkCountArgs} args - Arguments to filter Artworks to count.
     * @example
     * // Count the number of Artworks
     * const count = await prisma.artwork.count({
     *   where: {
     *     // ... the filter for the Artworks we want to count
     *   }
     * })
    **/
    count<T extends ArtworkCountArgs>(
      args?: Subset<T, ArtworkCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ArtworkCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Artwork.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ArtworkAggregateArgs>(args: Subset<T, ArtworkAggregateArgs>): Prisma.PrismaPromise<GetArtworkAggregateType<T>>

    /**
     * Group by Artwork.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ArtworkGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ArtworkGroupByArgs['orderBy'] }
        : { orderBy?: ArtworkGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ArtworkGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetArtworkGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Artwork model
   */
  readonly fields: ArtworkFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Artwork.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ArtworkClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    artist<T extends Artwork$artistArgs<ExtArgs> = {}>(args?: Subset<T, Artwork$artistArgs<ExtArgs>>): Prisma__ArtistClient<$Result.GetResult<Prisma.$ArtistPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
    artworkTags<T extends Artwork$artworkTagsArgs<ExtArgs> = {}>(args?: Subset<T, Artwork$artworkTagsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "findMany"> | Null>
    images<T extends Artwork$imagesArgs<ExtArgs> = {}>(args?: Subset<T, Artwork$imagesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Artwork model
   */ 
  interface ArtworkFieldRefs {
    readonly id: FieldRef<"Artwork", 'Int'>
    readonly title: FieldRef<"Artwork", 'String'>
    readonly description: FieldRef<"Artwork", 'String'>
    readonly artistId: FieldRef<"Artwork", 'Int'>
    readonly createdAt: FieldRef<"Artwork", 'DateTime'>
    readonly updatedAt: FieldRef<"Artwork", 'DateTime'>
    readonly descriptionLength: FieldRef<"Artwork", 'Int'>
    readonly directoryCreatedAt: FieldRef<"Artwork", 'DateTime'>
    readonly imageCount: FieldRef<"Artwork", 'Int'>
    readonly bookmarkCount: FieldRef<"Artwork", 'Int'>
    readonly externalId: FieldRef<"Artwork", 'String'>
    readonly isAiGenerated: FieldRef<"Artwork", 'Boolean'>
    readonly originalUrl: FieldRef<"Artwork", 'String'>
    readonly size: FieldRef<"Artwork", 'String'>
    readonly sourceDate: FieldRef<"Artwork", 'DateTime'>
    readonly sourceUrl: FieldRef<"Artwork", 'String'>
    readonly thumbnailUrl: FieldRef<"Artwork", 'String'>
    readonly xRestrict: FieldRef<"Artwork", 'String'>
  }
    

  // Custom InputTypes
  /**
   * Artwork findUnique
   */
  export type ArtworkFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    /**
     * Filter, which Artwork to fetch.
     */
    where: ArtworkWhereUniqueInput
  }

  /**
   * Artwork findUniqueOrThrow
   */
  export type ArtworkFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    /**
     * Filter, which Artwork to fetch.
     */
    where: ArtworkWhereUniqueInput
  }

  /**
   * Artwork findFirst
   */
  export type ArtworkFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    /**
     * Filter, which Artwork to fetch.
     */
    where?: ArtworkWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Artworks to fetch.
     */
    orderBy?: ArtworkOrderByWithRelationInput | ArtworkOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Artworks.
     */
    cursor?: ArtworkWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Artworks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Artworks.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Artworks.
     */
    distinct?: ArtworkScalarFieldEnum | ArtworkScalarFieldEnum[]
  }

  /**
   * Artwork findFirstOrThrow
   */
  export type ArtworkFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    /**
     * Filter, which Artwork to fetch.
     */
    where?: ArtworkWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Artworks to fetch.
     */
    orderBy?: ArtworkOrderByWithRelationInput | ArtworkOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Artworks.
     */
    cursor?: ArtworkWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Artworks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Artworks.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Artworks.
     */
    distinct?: ArtworkScalarFieldEnum | ArtworkScalarFieldEnum[]
  }

  /**
   * Artwork findMany
   */
  export type ArtworkFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    /**
     * Filter, which Artworks to fetch.
     */
    where?: ArtworkWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Artworks to fetch.
     */
    orderBy?: ArtworkOrderByWithRelationInput | ArtworkOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Artworks.
     */
    cursor?: ArtworkWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Artworks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Artworks.
     */
    skip?: number
    distinct?: ArtworkScalarFieldEnum | ArtworkScalarFieldEnum[]
  }

  /**
   * Artwork create
   */
  export type ArtworkCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    /**
     * The data needed to create a Artwork.
     */
    data: XOR<ArtworkCreateInput, ArtworkUncheckedCreateInput>
  }

  /**
   * Artwork createMany
   */
  export type ArtworkCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Artworks.
     */
    data: ArtworkCreateManyInput | ArtworkCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Artwork createManyAndReturn
   */
  export type ArtworkCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Artworks.
     */
    data: ArtworkCreateManyInput | ArtworkCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Artwork update
   */
  export type ArtworkUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    /**
     * The data needed to update a Artwork.
     */
    data: XOR<ArtworkUpdateInput, ArtworkUncheckedUpdateInput>
    /**
     * Choose, which Artwork to update.
     */
    where: ArtworkWhereUniqueInput
  }

  /**
   * Artwork updateMany
   */
  export type ArtworkUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Artworks.
     */
    data: XOR<ArtworkUpdateManyMutationInput, ArtworkUncheckedUpdateManyInput>
    /**
     * Filter which Artworks to update
     */
    where?: ArtworkWhereInput
  }

  /**
   * Artwork upsert
   */
  export type ArtworkUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    /**
     * The filter to search for the Artwork to update in case it exists.
     */
    where: ArtworkWhereUniqueInput
    /**
     * In case the Artwork found by the `where` argument doesn't exist, create a new Artwork with this data.
     */
    create: XOR<ArtworkCreateInput, ArtworkUncheckedCreateInput>
    /**
     * In case the Artwork was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ArtworkUpdateInput, ArtworkUncheckedUpdateInput>
  }

  /**
   * Artwork delete
   */
  export type ArtworkDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    /**
     * Filter which Artwork to delete.
     */
    where: ArtworkWhereUniqueInput
  }

  /**
   * Artwork deleteMany
   */
  export type ArtworkDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Artworks to delete
     */
    where?: ArtworkWhereInput
  }

  /**
   * Artwork.artist
   */
  export type Artwork$artistArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artist
     */
    select?: ArtistSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtistInclude<ExtArgs> | null
    where?: ArtistWhereInput
  }

  /**
   * Artwork.artworkTags
   */
  export type Artwork$artworkTagsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    where?: ArtworkTagWhereInput
    orderBy?: ArtworkTagOrderByWithRelationInput | ArtworkTagOrderByWithRelationInput[]
    cursor?: ArtworkTagWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ArtworkTagScalarFieldEnum | ArtworkTagScalarFieldEnum[]
  }

  /**
   * Artwork.images
   */
  export type Artwork$imagesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    where?: ImageWhereInput
    orderBy?: ImageOrderByWithRelationInput | ImageOrderByWithRelationInput[]
    cursor?: ImageWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ImageScalarFieldEnum | ImageScalarFieldEnum[]
  }

  /**
   * Artwork without action
   */
  export type ArtworkDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
  }


  /**
   * Model Tag
   */

  export type AggregateTag = {
    _count: TagCountAggregateOutputType | null
    _avg: TagAvgAggregateOutputType | null
    _sum: TagSumAggregateOutputType | null
    _min: TagMinAggregateOutputType | null
    _max: TagMaxAggregateOutputType | null
  }

  export type TagAvgAggregateOutputType = {
    id: number | null
    artworkCount: number | null
  }

  export type TagSumAggregateOutputType = {
    id: number | null
    artworkCount: number | null
  }

  export type TagMinAggregateOutputType = {
    id: number | null
    name: string | null
    name_zh: string | null
    description: string | null
    artworkCount: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TagMaxAggregateOutputType = {
    id: number | null
    name: string | null
    name_zh: string | null
    description: string | null
    artworkCount: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TagCountAggregateOutputType = {
    id: number
    name: number
    name_zh: number
    description: number
    artworkCount: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TagAvgAggregateInputType = {
    id?: true
    artworkCount?: true
  }

  export type TagSumAggregateInputType = {
    id?: true
    artworkCount?: true
  }

  export type TagMinAggregateInputType = {
    id?: true
    name?: true
    name_zh?: true
    description?: true
    artworkCount?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TagMaxAggregateInputType = {
    id?: true
    name?: true
    name_zh?: true
    description?: true
    artworkCount?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TagCountAggregateInputType = {
    id?: true
    name?: true
    name_zh?: true
    description?: true
    artworkCount?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TagAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Tag to aggregate.
     */
    where?: TagWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tags to fetch.
     */
    orderBy?: TagOrderByWithRelationInput | TagOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TagWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tags from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tags.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Tags
    **/
    _count?: true | TagCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: TagAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: TagSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TagMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TagMaxAggregateInputType
  }

  export type GetTagAggregateType<T extends TagAggregateArgs> = {
        [P in keyof T & keyof AggregateTag]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTag[P]>
      : GetScalarType<T[P], AggregateTag[P]>
  }




  export type TagGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TagWhereInput
    orderBy?: TagOrderByWithAggregationInput | TagOrderByWithAggregationInput[]
    by: TagScalarFieldEnum[] | TagScalarFieldEnum
    having?: TagScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TagCountAggregateInputType | true
    _avg?: TagAvgAggregateInputType
    _sum?: TagSumAggregateInputType
    _min?: TagMinAggregateInputType
    _max?: TagMaxAggregateInputType
  }

  export type TagGroupByOutputType = {
    id: number
    name: string
    name_zh: string | null
    description: string | null
    artworkCount: number
    createdAt: Date
    updatedAt: Date
    _count: TagCountAggregateOutputType | null
    _avg: TagAvgAggregateOutputType | null
    _sum: TagSumAggregateOutputType | null
    _min: TagMinAggregateOutputType | null
    _max: TagMaxAggregateOutputType | null
  }

  type GetTagGroupByPayload<T extends TagGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TagGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TagGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TagGroupByOutputType[P]>
            : GetScalarType<T[P], TagGroupByOutputType[P]>
        }
      >
    >


  export type TagSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    name_zh?: boolean
    description?: boolean
    artworkCount?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    artworkTags?: boolean | Tag$artworkTagsArgs<ExtArgs>
    _count?: boolean | TagCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["tag"]>

  export type TagSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    name_zh?: boolean
    description?: boolean
    artworkCount?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["tag"]>

  export type TagSelectScalar = {
    id?: boolean
    name?: boolean
    name_zh?: boolean
    description?: boolean
    artworkCount?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TagInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artworkTags?: boolean | Tag$artworkTagsArgs<ExtArgs>
    _count?: boolean | TagCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type TagIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $TagPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Tag"
    objects: {
      artworkTags: Prisma.$ArtworkTagPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: number
      name: string
      name_zh: string | null
      description: string | null
      artworkCount: number
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["tag"]>
    composites: {}
  }

  type TagGetPayload<S extends boolean | null | undefined | TagDefaultArgs> = $Result.GetResult<Prisma.$TagPayload, S>

  type TagCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TagFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TagCountAggregateInputType | true
    }

  export interface TagDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Tag'], meta: { name: 'Tag' } }
    /**
     * Find zero or one Tag that matches the filter.
     * @param {TagFindUniqueArgs} args - Arguments to find a Tag
     * @example
     * // Get one Tag
     * const tag = await prisma.tag.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TagFindUniqueArgs>(args: SelectSubset<T, TagFindUniqueArgs<ExtArgs>>): Prisma__TagClient<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Tag that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TagFindUniqueOrThrowArgs} args - Arguments to find a Tag
     * @example
     * // Get one Tag
     * const tag = await prisma.tag.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TagFindUniqueOrThrowArgs>(args: SelectSubset<T, TagFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TagClient<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Tag that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TagFindFirstArgs} args - Arguments to find a Tag
     * @example
     * // Get one Tag
     * const tag = await prisma.tag.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TagFindFirstArgs>(args?: SelectSubset<T, TagFindFirstArgs<ExtArgs>>): Prisma__TagClient<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Tag that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TagFindFirstOrThrowArgs} args - Arguments to find a Tag
     * @example
     * // Get one Tag
     * const tag = await prisma.tag.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TagFindFirstOrThrowArgs>(args?: SelectSubset<T, TagFindFirstOrThrowArgs<ExtArgs>>): Prisma__TagClient<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Tags that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TagFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Tags
     * const tags = await prisma.tag.findMany()
     * 
     * // Get first 10 Tags
     * const tags = await prisma.tag.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const tagWithIdOnly = await prisma.tag.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TagFindManyArgs>(args?: SelectSubset<T, TagFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Tag.
     * @param {TagCreateArgs} args - Arguments to create a Tag.
     * @example
     * // Create one Tag
     * const Tag = await prisma.tag.create({
     *   data: {
     *     // ... data to create a Tag
     *   }
     * })
     * 
     */
    create<T extends TagCreateArgs>(args: SelectSubset<T, TagCreateArgs<ExtArgs>>): Prisma__TagClient<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Tags.
     * @param {TagCreateManyArgs} args - Arguments to create many Tags.
     * @example
     * // Create many Tags
     * const tag = await prisma.tag.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TagCreateManyArgs>(args?: SelectSubset<T, TagCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Tags and returns the data saved in the database.
     * @param {TagCreateManyAndReturnArgs} args - Arguments to create many Tags.
     * @example
     * // Create many Tags
     * const tag = await prisma.tag.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Tags and only return the `id`
     * const tagWithIdOnly = await prisma.tag.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TagCreateManyAndReturnArgs>(args?: SelectSubset<T, TagCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Tag.
     * @param {TagDeleteArgs} args - Arguments to delete one Tag.
     * @example
     * // Delete one Tag
     * const Tag = await prisma.tag.delete({
     *   where: {
     *     // ... filter to delete one Tag
     *   }
     * })
     * 
     */
    delete<T extends TagDeleteArgs>(args: SelectSubset<T, TagDeleteArgs<ExtArgs>>): Prisma__TagClient<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Tag.
     * @param {TagUpdateArgs} args - Arguments to update one Tag.
     * @example
     * // Update one Tag
     * const tag = await prisma.tag.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TagUpdateArgs>(args: SelectSubset<T, TagUpdateArgs<ExtArgs>>): Prisma__TagClient<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Tags.
     * @param {TagDeleteManyArgs} args - Arguments to filter Tags to delete.
     * @example
     * // Delete a few Tags
     * const { count } = await prisma.tag.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TagDeleteManyArgs>(args?: SelectSubset<T, TagDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Tags.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TagUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Tags
     * const tag = await prisma.tag.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TagUpdateManyArgs>(args: SelectSubset<T, TagUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Tag.
     * @param {TagUpsertArgs} args - Arguments to update or create a Tag.
     * @example
     * // Update or create a Tag
     * const tag = await prisma.tag.upsert({
     *   create: {
     *     // ... data to create a Tag
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Tag we want to update
     *   }
     * })
     */
    upsert<T extends TagUpsertArgs>(args: SelectSubset<T, TagUpsertArgs<ExtArgs>>): Prisma__TagClient<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Tags.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TagCountArgs} args - Arguments to filter Tags to count.
     * @example
     * // Count the number of Tags
     * const count = await prisma.tag.count({
     *   where: {
     *     // ... the filter for the Tags we want to count
     *   }
     * })
    **/
    count<T extends TagCountArgs>(
      args?: Subset<T, TagCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TagCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Tag.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TagAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TagAggregateArgs>(args: Subset<T, TagAggregateArgs>): Prisma.PrismaPromise<GetTagAggregateType<T>>

    /**
     * Group by Tag.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TagGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TagGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TagGroupByArgs['orderBy'] }
        : { orderBy?: TagGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TagGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTagGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Tag model
   */
  readonly fields: TagFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Tag.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TagClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    artworkTags<T extends Tag$artworkTagsArgs<ExtArgs> = {}>(args?: Subset<T, Tag$artworkTagsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Tag model
   */ 
  interface TagFieldRefs {
    readonly id: FieldRef<"Tag", 'Int'>
    readonly name: FieldRef<"Tag", 'String'>
    readonly name_zh: FieldRef<"Tag", 'String'>
    readonly description: FieldRef<"Tag", 'String'>
    readonly artworkCount: FieldRef<"Tag", 'Int'>
    readonly createdAt: FieldRef<"Tag", 'DateTime'>
    readonly updatedAt: FieldRef<"Tag", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Tag findUnique
   */
  export type TagFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
    /**
     * Filter, which Tag to fetch.
     */
    where: TagWhereUniqueInput
  }

  /**
   * Tag findUniqueOrThrow
   */
  export type TagFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
    /**
     * Filter, which Tag to fetch.
     */
    where: TagWhereUniqueInput
  }

  /**
   * Tag findFirst
   */
  export type TagFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
    /**
     * Filter, which Tag to fetch.
     */
    where?: TagWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tags to fetch.
     */
    orderBy?: TagOrderByWithRelationInput | TagOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Tags.
     */
    cursor?: TagWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tags from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tags.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Tags.
     */
    distinct?: TagScalarFieldEnum | TagScalarFieldEnum[]
  }

  /**
   * Tag findFirstOrThrow
   */
  export type TagFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
    /**
     * Filter, which Tag to fetch.
     */
    where?: TagWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tags to fetch.
     */
    orderBy?: TagOrderByWithRelationInput | TagOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Tags.
     */
    cursor?: TagWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tags from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tags.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Tags.
     */
    distinct?: TagScalarFieldEnum | TagScalarFieldEnum[]
  }

  /**
   * Tag findMany
   */
  export type TagFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
    /**
     * Filter, which Tags to fetch.
     */
    where?: TagWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tags to fetch.
     */
    orderBy?: TagOrderByWithRelationInput | TagOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Tags.
     */
    cursor?: TagWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tags from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tags.
     */
    skip?: number
    distinct?: TagScalarFieldEnum | TagScalarFieldEnum[]
  }

  /**
   * Tag create
   */
  export type TagCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
    /**
     * The data needed to create a Tag.
     */
    data: XOR<TagCreateInput, TagUncheckedCreateInput>
  }

  /**
   * Tag createMany
   */
  export type TagCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Tags.
     */
    data: TagCreateManyInput | TagCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Tag createManyAndReturn
   */
  export type TagCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Tags.
     */
    data: TagCreateManyInput | TagCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Tag update
   */
  export type TagUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
    /**
     * The data needed to update a Tag.
     */
    data: XOR<TagUpdateInput, TagUncheckedUpdateInput>
    /**
     * Choose, which Tag to update.
     */
    where: TagWhereUniqueInput
  }

  /**
   * Tag updateMany
   */
  export type TagUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Tags.
     */
    data: XOR<TagUpdateManyMutationInput, TagUncheckedUpdateManyInput>
    /**
     * Filter which Tags to update
     */
    where?: TagWhereInput
  }

  /**
   * Tag upsert
   */
  export type TagUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
    /**
     * The filter to search for the Tag to update in case it exists.
     */
    where: TagWhereUniqueInput
    /**
     * In case the Tag found by the `where` argument doesn't exist, create a new Tag with this data.
     */
    create: XOR<TagCreateInput, TagUncheckedCreateInput>
    /**
     * In case the Tag was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TagUpdateInput, TagUncheckedUpdateInput>
  }

  /**
   * Tag delete
   */
  export type TagDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
    /**
     * Filter which Tag to delete.
     */
    where: TagWhereUniqueInput
  }

  /**
   * Tag deleteMany
   */
  export type TagDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Tags to delete
     */
    where?: TagWhereInput
  }

  /**
   * Tag.artworkTags
   */
  export type Tag$artworkTagsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    where?: ArtworkTagWhereInput
    orderBy?: ArtworkTagOrderByWithRelationInput | ArtworkTagOrderByWithRelationInput[]
    cursor?: ArtworkTagWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ArtworkTagScalarFieldEnum | ArtworkTagScalarFieldEnum[]
  }

  /**
   * Tag without action
   */
  export type TagDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tag
     */
    select?: TagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TagInclude<ExtArgs> | null
  }


  /**
   * Model ArtworkTag
   */

  export type AggregateArtworkTag = {
    _count: ArtworkTagCountAggregateOutputType | null
    _avg: ArtworkTagAvgAggregateOutputType | null
    _sum: ArtworkTagSumAggregateOutputType | null
    _min: ArtworkTagMinAggregateOutputType | null
    _max: ArtworkTagMaxAggregateOutputType | null
  }

  export type ArtworkTagAvgAggregateOutputType = {
    id: number | null
    artworkId: number | null
    tagId: number | null
  }

  export type ArtworkTagSumAggregateOutputType = {
    id: number | null
    artworkId: number | null
    tagId: number | null
  }

  export type ArtworkTagMinAggregateOutputType = {
    id: number | null
    artworkId: number | null
    tagId: number | null
    createdAt: Date | null
  }

  export type ArtworkTagMaxAggregateOutputType = {
    id: number | null
    artworkId: number | null
    tagId: number | null
    createdAt: Date | null
  }

  export type ArtworkTagCountAggregateOutputType = {
    id: number
    artworkId: number
    tagId: number
    createdAt: number
    _all: number
  }


  export type ArtworkTagAvgAggregateInputType = {
    id?: true
    artworkId?: true
    tagId?: true
  }

  export type ArtworkTagSumAggregateInputType = {
    id?: true
    artworkId?: true
    tagId?: true
  }

  export type ArtworkTagMinAggregateInputType = {
    id?: true
    artworkId?: true
    tagId?: true
    createdAt?: true
  }

  export type ArtworkTagMaxAggregateInputType = {
    id?: true
    artworkId?: true
    tagId?: true
    createdAt?: true
  }

  export type ArtworkTagCountAggregateInputType = {
    id?: true
    artworkId?: true
    tagId?: true
    createdAt?: true
    _all?: true
  }

  export type ArtworkTagAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ArtworkTag to aggregate.
     */
    where?: ArtworkTagWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ArtworkTags to fetch.
     */
    orderBy?: ArtworkTagOrderByWithRelationInput | ArtworkTagOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ArtworkTagWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ArtworkTags from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ArtworkTags.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned ArtworkTags
    **/
    _count?: true | ArtworkTagCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ArtworkTagAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ArtworkTagSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ArtworkTagMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ArtworkTagMaxAggregateInputType
  }

  export type GetArtworkTagAggregateType<T extends ArtworkTagAggregateArgs> = {
        [P in keyof T & keyof AggregateArtworkTag]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateArtworkTag[P]>
      : GetScalarType<T[P], AggregateArtworkTag[P]>
  }




  export type ArtworkTagGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ArtworkTagWhereInput
    orderBy?: ArtworkTagOrderByWithAggregationInput | ArtworkTagOrderByWithAggregationInput[]
    by: ArtworkTagScalarFieldEnum[] | ArtworkTagScalarFieldEnum
    having?: ArtworkTagScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ArtworkTagCountAggregateInputType | true
    _avg?: ArtworkTagAvgAggregateInputType
    _sum?: ArtworkTagSumAggregateInputType
    _min?: ArtworkTagMinAggregateInputType
    _max?: ArtworkTagMaxAggregateInputType
  }

  export type ArtworkTagGroupByOutputType = {
    id: number
    artworkId: number
    tagId: number
    createdAt: Date
    _count: ArtworkTagCountAggregateOutputType | null
    _avg: ArtworkTagAvgAggregateOutputType | null
    _sum: ArtworkTagSumAggregateOutputType | null
    _min: ArtworkTagMinAggregateOutputType | null
    _max: ArtworkTagMaxAggregateOutputType | null
  }

  type GetArtworkTagGroupByPayload<T extends ArtworkTagGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ArtworkTagGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ArtworkTagGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ArtworkTagGroupByOutputType[P]>
            : GetScalarType<T[P], ArtworkTagGroupByOutputType[P]>
        }
      >
    >


  export type ArtworkTagSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    artworkId?: boolean
    tagId?: boolean
    createdAt?: boolean
    artwork?: boolean | ArtworkDefaultArgs<ExtArgs>
    tag?: boolean | TagDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["artworkTag"]>

  export type ArtworkTagSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    artworkId?: boolean
    tagId?: boolean
    createdAt?: boolean
    artwork?: boolean | ArtworkDefaultArgs<ExtArgs>
    tag?: boolean | TagDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["artworkTag"]>

  export type ArtworkTagSelectScalar = {
    id?: boolean
    artworkId?: boolean
    tagId?: boolean
    createdAt?: boolean
  }

  export type ArtworkTagInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artwork?: boolean | ArtworkDefaultArgs<ExtArgs>
    tag?: boolean | TagDefaultArgs<ExtArgs>
  }
  export type ArtworkTagIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artwork?: boolean | ArtworkDefaultArgs<ExtArgs>
    tag?: boolean | TagDefaultArgs<ExtArgs>
  }

  export type $ArtworkTagPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "ArtworkTag"
    objects: {
      artwork: Prisma.$ArtworkPayload<ExtArgs>
      tag: Prisma.$TagPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: number
      artworkId: number
      tagId: number
      createdAt: Date
    }, ExtArgs["result"]["artworkTag"]>
    composites: {}
  }

  type ArtworkTagGetPayload<S extends boolean | null | undefined | ArtworkTagDefaultArgs> = $Result.GetResult<Prisma.$ArtworkTagPayload, S>

  type ArtworkTagCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ArtworkTagFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ArtworkTagCountAggregateInputType | true
    }

  export interface ArtworkTagDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['ArtworkTag'], meta: { name: 'ArtworkTag' } }
    /**
     * Find zero or one ArtworkTag that matches the filter.
     * @param {ArtworkTagFindUniqueArgs} args - Arguments to find a ArtworkTag
     * @example
     * // Get one ArtworkTag
     * const artworkTag = await prisma.artworkTag.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ArtworkTagFindUniqueArgs>(args: SelectSubset<T, ArtworkTagFindUniqueArgs<ExtArgs>>): Prisma__ArtworkTagClient<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one ArtworkTag that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ArtworkTagFindUniqueOrThrowArgs} args - Arguments to find a ArtworkTag
     * @example
     * // Get one ArtworkTag
     * const artworkTag = await prisma.artworkTag.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ArtworkTagFindUniqueOrThrowArgs>(args: SelectSubset<T, ArtworkTagFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ArtworkTagClient<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first ArtworkTag that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkTagFindFirstArgs} args - Arguments to find a ArtworkTag
     * @example
     * // Get one ArtworkTag
     * const artworkTag = await prisma.artworkTag.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ArtworkTagFindFirstArgs>(args?: SelectSubset<T, ArtworkTagFindFirstArgs<ExtArgs>>): Prisma__ArtworkTagClient<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first ArtworkTag that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkTagFindFirstOrThrowArgs} args - Arguments to find a ArtworkTag
     * @example
     * // Get one ArtworkTag
     * const artworkTag = await prisma.artworkTag.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ArtworkTagFindFirstOrThrowArgs>(args?: SelectSubset<T, ArtworkTagFindFirstOrThrowArgs<ExtArgs>>): Prisma__ArtworkTagClient<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more ArtworkTags that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkTagFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all ArtworkTags
     * const artworkTags = await prisma.artworkTag.findMany()
     * 
     * // Get first 10 ArtworkTags
     * const artworkTags = await prisma.artworkTag.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const artworkTagWithIdOnly = await prisma.artworkTag.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ArtworkTagFindManyArgs>(args?: SelectSubset<T, ArtworkTagFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a ArtworkTag.
     * @param {ArtworkTagCreateArgs} args - Arguments to create a ArtworkTag.
     * @example
     * // Create one ArtworkTag
     * const ArtworkTag = await prisma.artworkTag.create({
     *   data: {
     *     // ... data to create a ArtworkTag
     *   }
     * })
     * 
     */
    create<T extends ArtworkTagCreateArgs>(args: SelectSubset<T, ArtworkTagCreateArgs<ExtArgs>>): Prisma__ArtworkTagClient<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many ArtworkTags.
     * @param {ArtworkTagCreateManyArgs} args - Arguments to create many ArtworkTags.
     * @example
     * // Create many ArtworkTags
     * const artworkTag = await prisma.artworkTag.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ArtworkTagCreateManyArgs>(args?: SelectSubset<T, ArtworkTagCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many ArtworkTags and returns the data saved in the database.
     * @param {ArtworkTagCreateManyAndReturnArgs} args - Arguments to create many ArtworkTags.
     * @example
     * // Create many ArtworkTags
     * const artworkTag = await prisma.artworkTag.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many ArtworkTags and only return the `id`
     * const artworkTagWithIdOnly = await prisma.artworkTag.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ArtworkTagCreateManyAndReturnArgs>(args?: SelectSubset<T, ArtworkTagCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a ArtworkTag.
     * @param {ArtworkTagDeleteArgs} args - Arguments to delete one ArtworkTag.
     * @example
     * // Delete one ArtworkTag
     * const ArtworkTag = await prisma.artworkTag.delete({
     *   where: {
     *     // ... filter to delete one ArtworkTag
     *   }
     * })
     * 
     */
    delete<T extends ArtworkTagDeleteArgs>(args: SelectSubset<T, ArtworkTagDeleteArgs<ExtArgs>>): Prisma__ArtworkTagClient<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one ArtworkTag.
     * @param {ArtworkTagUpdateArgs} args - Arguments to update one ArtworkTag.
     * @example
     * // Update one ArtworkTag
     * const artworkTag = await prisma.artworkTag.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ArtworkTagUpdateArgs>(args: SelectSubset<T, ArtworkTagUpdateArgs<ExtArgs>>): Prisma__ArtworkTagClient<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more ArtworkTags.
     * @param {ArtworkTagDeleteManyArgs} args - Arguments to filter ArtworkTags to delete.
     * @example
     * // Delete a few ArtworkTags
     * const { count } = await prisma.artworkTag.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ArtworkTagDeleteManyArgs>(args?: SelectSubset<T, ArtworkTagDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ArtworkTags.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkTagUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many ArtworkTags
     * const artworkTag = await prisma.artworkTag.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ArtworkTagUpdateManyArgs>(args: SelectSubset<T, ArtworkTagUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one ArtworkTag.
     * @param {ArtworkTagUpsertArgs} args - Arguments to update or create a ArtworkTag.
     * @example
     * // Update or create a ArtworkTag
     * const artworkTag = await prisma.artworkTag.upsert({
     *   create: {
     *     // ... data to create a ArtworkTag
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the ArtworkTag we want to update
     *   }
     * })
     */
    upsert<T extends ArtworkTagUpsertArgs>(args: SelectSubset<T, ArtworkTagUpsertArgs<ExtArgs>>): Prisma__ArtworkTagClient<$Result.GetResult<Prisma.$ArtworkTagPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of ArtworkTags.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkTagCountArgs} args - Arguments to filter ArtworkTags to count.
     * @example
     * // Count the number of ArtworkTags
     * const count = await prisma.artworkTag.count({
     *   where: {
     *     // ... the filter for the ArtworkTags we want to count
     *   }
     * })
    **/
    count<T extends ArtworkTagCountArgs>(
      args?: Subset<T, ArtworkTagCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ArtworkTagCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a ArtworkTag.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkTagAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ArtworkTagAggregateArgs>(args: Subset<T, ArtworkTagAggregateArgs>): Prisma.PrismaPromise<GetArtworkTagAggregateType<T>>

    /**
     * Group by ArtworkTag.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ArtworkTagGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ArtworkTagGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ArtworkTagGroupByArgs['orderBy'] }
        : { orderBy?: ArtworkTagGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ArtworkTagGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetArtworkTagGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the ArtworkTag model
   */
  readonly fields: ArtworkTagFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for ArtworkTag.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ArtworkTagClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    artwork<T extends ArtworkDefaultArgs<ExtArgs> = {}>(args?: Subset<T, ArtworkDefaultArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    tag<T extends TagDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TagDefaultArgs<ExtArgs>>): Prisma__TagClient<$Result.GetResult<Prisma.$TagPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the ArtworkTag model
   */ 
  interface ArtworkTagFieldRefs {
    readonly id: FieldRef<"ArtworkTag", 'Int'>
    readonly artworkId: FieldRef<"ArtworkTag", 'Int'>
    readonly tagId: FieldRef<"ArtworkTag", 'Int'>
    readonly createdAt: FieldRef<"ArtworkTag", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * ArtworkTag findUnique
   */
  export type ArtworkTagFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    /**
     * Filter, which ArtworkTag to fetch.
     */
    where: ArtworkTagWhereUniqueInput
  }

  /**
   * ArtworkTag findUniqueOrThrow
   */
  export type ArtworkTagFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    /**
     * Filter, which ArtworkTag to fetch.
     */
    where: ArtworkTagWhereUniqueInput
  }

  /**
   * ArtworkTag findFirst
   */
  export type ArtworkTagFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    /**
     * Filter, which ArtworkTag to fetch.
     */
    where?: ArtworkTagWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ArtworkTags to fetch.
     */
    orderBy?: ArtworkTagOrderByWithRelationInput | ArtworkTagOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ArtworkTags.
     */
    cursor?: ArtworkTagWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ArtworkTags from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ArtworkTags.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ArtworkTags.
     */
    distinct?: ArtworkTagScalarFieldEnum | ArtworkTagScalarFieldEnum[]
  }

  /**
   * ArtworkTag findFirstOrThrow
   */
  export type ArtworkTagFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    /**
     * Filter, which ArtworkTag to fetch.
     */
    where?: ArtworkTagWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ArtworkTags to fetch.
     */
    orderBy?: ArtworkTagOrderByWithRelationInput | ArtworkTagOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ArtworkTags.
     */
    cursor?: ArtworkTagWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ArtworkTags from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ArtworkTags.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ArtworkTags.
     */
    distinct?: ArtworkTagScalarFieldEnum | ArtworkTagScalarFieldEnum[]
  }

  /**
   * ArtworkTag findMany
   */
  export type ArtworkTagFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    /**
     * Filter, which ArtworkTags to fetch.
     */
    where?: ArtworkTagWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ArtworkTags to fetch.
     */
    orderBy?: ArtworkTagOrderByWithRelationInput | ArtworkTagOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing ArtworkTags.
     */
    cursor?: ArtworkTagWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ArtworkTags from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ArtworkTags.
     */
    skip?: number
    distinct?: ArtworkTagScalarFieldEnum | ArtworkTagScalarFieldEnum[]
  }

  /**
   * ArtworkTag create
   */
  export type ArtworkTagCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    /**
     * The data needed to create a ArtworkTag.
     */
    data: XOR<ArtworkTagCreateInput, ArtworkTagUncheckedCreateInput>
  }

  /**
   * ArtworkTag createMany
   */
  export type ArtworkTagCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many ArtworkTags.
     */
    data: ArtworkTagCreateManyInput | ArtworkTagCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ArtworkTag createManyAndReturn
   */
  export type ArtworkTagCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many ArtworkTags.
     */
    data: ArtworkTagCreateManyInput | ArtworkTagCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * ArtworkTag update
   */
  export type ArtworkTagUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    /**
     * The data needed to update a ArtworkTag.
     */
    data: XOR<ArtworkTagUpdateInput, ArtworkTagUncheckedUpdateInput>
    /**
     * Choose, which ArtworkTag to update.
     */
    where: ArtworkTagWhereUniqueInput
  }

  /**
   * ArtworkTag updateMany
   */
  export type ArtworkTagUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update ArtworkTags.
     */
    data: XOR<ArtworkTagUpdateManyMutationInput, ArtworkTagUncheckedUpdateManyInput>
    /**
     * Filter which ArtworkTags to update
     */
    where?: ArtworkTagWhereInput
  }

  /**
   * ArtworkTag upsert
   */
  export type ArtworkTagUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    /**
     * The filter to search for the ArtworkTag to update in case it exists.
     */
    where: ArtworkTagWhereUniqueInput
    /**
     * In case the ArtworkTag found by the `where` argument doesn't exist, create a new ArtworkTag with this data.
     */
    create: XOR<ArtworkTagCreateInput, ArtworkTagUncheckedCreateInput>
    /**
     * In case the ArtworkTag was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ArtworkTagUpdateInput, ArtworkTagUncheckedUpdateInput>
  }

  /**
   * ArtworkTag delete
   */
  export type ArtworkTagDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
    /**
     * Filter which ArtworkTag to delete.
     */
    where: ArtworkTagWhereUniqueInput
  }

  /**
   * ArtworkTag deleteMany
   */
  export type ArtworkTagDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ArtworkTags to delete
     */
    where?: ArtworkTagWhereInput
  }

  /**
   * ArtworkTag without action
   */
  export type ArtworkTagDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ArtworkTag
     */
    select?: ArtworkTagSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkTagInclude<ExtArgs> | null
  }


  /**
   * Model Image
   */

  export type AggregateImage = {
    _count: ImageCountAggregateOutputType | null
    _avg: ImageAvgAggregateOutputType | null
    _sum: ImageSumAggregateOutputType | null
    _min: ImageMinAggregateOutputType | null
    _max: ImageMaxAggregateOutputType | null
  }

  export type ImageAvgAggregateOutputType = {
    id: number | null
    width: number | null
    height: number | null
    size: number | null
    sortOrder: number | null
    artworkId: number | null
  }

  export type ImageSumAggregateOutputType = {
    id: number | null
    width: number | null
    height: number | null
    size: number | null
    sortOrder: number | null
    artworkId: number | null
  }

  export type ImageMinAggregateOutputType = {
    id: number | null
    path: string | null
    width: number | null
    height: number | null
    size: number | null
    sortOrder: number | null
    artworkId: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ImageMaxAggregateOutputType = {
    id: number | null
    path: string | null
    width: number | null
    height: number | null
    size: number | null
    sortOrder: number | null
    artworkId: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ImageCountAggregateOutputType = {
    id: number
    path: number
    width: number
    height: number
    size: number
    sortOrder: number
    artworkId: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type ImageAvgAggregateInputType = {
    id?: true
    width?: true
    height?: true
    size?: true
    sortOrder?: true
    artworkId?: true
  }

  export type ImageSumAggregateInputType = {
    id?: true
    width?: true
    height?: true
    size?: true
    sortOrder?: true
    artworkId?: true
  }

  export type ImageMinAggregateInputType = {
    id?: true
    path?: true
    width?: true
    height?: true
    size?: true
    sortOrder?: true
    artworkId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ImageMaxAggregateInputType = {
    id?: true
    path?: true
    width?: true
    height?: true
    size?: true
    sortOrder?: true
    artworkId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ImageCountAggregateInputType = {
    id?: true
    path?: true
    width?: true
    height?: true
    size?: true
    sortOrder?: true
    artworkId?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type ImageAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Image to aggregate.
     */
    where?: ImageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Images to fetch.
     */
    orderBy?: ImageOrderByWithRelationInput | ImageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ImageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Images from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Images.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Images
    **/
    _count?: true | ImageCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ImageAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ImageSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ImageMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ImageMaxAggregateInputType
  }

  export type GetImageAggregateType<T extends ImageAggregateArgs> = {
        [P in keyof T & keyof AggregateImage]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateImage[P]>
      : GetScalarType<T[P], AggregateImage[P]>
  }




  export type ImageGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ImageWhereInput
    orderBy?: ImageOrderByWithAggregationInput | ImageOrderByWithAggregationInput[]
    by: ImageScalarFieldEnum[] | ImageScalarFieldEnum
    having?: ImageScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ImageCountAggregateInputType | true
    _avg?: ImageAvgAggregateInputType
    _sum?: ImageSumAggregateInputType
    _min?: ImageMinAggregateInputType
    _max?: ImageMaxAggregateInputType
  }

  export type ImageGroupByOutputType = {
    id: number
    path: string
    width: number | null
    height: number | null
    size: number | null
    sortOrder: number
    artworkId: number | null
    createdAt: Date
    updatedAt: Date
    _count: ImageCountAggregateOutputType | null
    _avg: ImageAvgAggregateOutputType | null
    _sum: ImageSumAggregateOutputType | null
    _min: ImageMinAggregateOutputType | null
    _max: ImageMaxAggregateOutputType | null
  }

  type GetImageGroupByPayload<T extends ImageGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ImageGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ImageGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ImageGroupByOutputType[P]>
            : GetScalarType<T[P], ImageGroupByOutputType[P]>
        }
      >
    >


  export type ImageSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    path?: boolean
    width?: boolean
    height?: boolean
    size?: boolean
    sortOrder?: boolean
    artworkId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    artwork?: boolean | Image$artworkArgs<ExtArgs>
  }, ExtArgs["result"]["image"]>

  export type ImageSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    path?: boolean
    width?: boolean
    height?: boolean
    size?: boolean
    sortOrder?: boolean
    artworkId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    artwork?: boolean | Image$artworkArgs<ExtArgs>
  }, ExtArgs["result"]["image"]>

  export type ImageSelectScalar = {
    id?: boolean
    path?: boolean
    width?: boolean
    height?: boolean
    size?: boolean
    sortOrder?: boolean
    artworkId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type ImageInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artwork?: boolean | Image$artworkArgs<ExtArgs>
  }
  export type ImageIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    artwork?: boolean | Image$artworkArgs<ExtArgs>
  }

  export type $ImagePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Image"
    objects: {
      artwork: Prisma.$ArtworkPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: number
      path: string
      width: number | null
      height: number | null
      size: number | null
      sortOrder: number
      artworkId: number | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["image"]>
    composites: {}
  }

  type ImageGetPayload<S extends boolean | null | undefined | ImageDefaultArgs> = $Result.GetResult<Prisma.$ImagePayload, S>

  type ImageCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ImageFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ImageCountAggregateInputType | true
    }

  export interface ImageDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Image'], meta: { name: 'Image' } }
    /**
     * Find zero or one Image that matches the filter.
     * @param {ImageFindUniqueArgs} args - Arguments to find a Image
     * @example
     * // Get one Image
     * const image = await prisma.image.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ImageFindUniqueArgs>(args: SelectSubset<T, ImageFindUniqueArgs<ExtArgs>>): Prisma__ImageClient<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Image that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ImageFindUniqueOrThrowArgs} args - Arguments to find a Image
     * @example
     * // Get one Image
     * const image = await prisma.image.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ImageFindUniqueOrThrowArgs>(args: SelectSubset<T, ImageFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ImageClient<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Image that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ImageFindFirstArgs} args - Arguments to find a Image
     * @example
     * // Get one Image
     * const image = await prisma.image.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ImageFindFirstArgs>(args?: SelectSubset<T, ImageFindFirstArgs<ExtArgs>>): Prisma__ImageClient<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Image that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ImageFindFirstOrThrowArgs} args - Arguments to find a Image
     * @example
     * // Get one Image
     * const image = await prisma.image.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ImageFindFirstOrThrowArgs>(args?: SelectSubset<T, ImageFindFirstOrThrowArgs<ExtArgs>>): Prisma__ImageClient<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Images that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ImageFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Images
     * const images = await prisma.image.findMany()
     * 
     * // Get first 10 Images
     * const images = await prisma.image.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const imageWithIdOnly = await prisma.image.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ImageFindManyArgs>(args?: SelectSubset<T, ImageFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Image.
     * @param {ImageCreateArgs} args - Arguments to create a Image.
     * @example
     * // Create one Image
     * const Image = await prisma.image.create({
     *   data: {
     *     // ... data to create a Image
     *   }
     * })
     * 
     */
    create<T extends ImageCreateArgs>(args: SelectSubset<T, ImageCreateArgs<ExtArgs>>): Prisma__ImageClient<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Images.
     * @param {ImageCreateManyArgs} args - Arguments to create many Images.
     * @example
     * // Create many Images
     * const image = await prisma.image.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ImageCreateManyArgs>(args?: SelectSubset<T, ImageCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Images and returns the data saved in the database.
     * @param {ImageCreateManyAndReturnArgs} args - Arguments to create many Images.
     * @example
     * // Create many Images
     * const image = await prisma.image.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Images and only return the `id`
     * const imageWithIdOnly = await prisma.image.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ImageCreateManyAndReturnArgs>(args?: SelectSubset<T, ImageCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Image.
     * @param {ImageDeleteArgs} args - Arguments to delete one Image.
     * @example
     * // Delete one Image
     * const Image = await prisma.image.delete({
     *   where: {
     *     // ... filter to delete one Image
     *   }
     * })
     * 
     */
    delete<T extends ImageDeleteArgs>(args: SelectSubset<T, ImageDeleteArgs<ExtArgs>>): Prisma__ImageClient<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Image.
     * @param {ImageUpdateArgs} args - Arguments to update one Image.
     * @example
     * // Update one Image
     * const image = await prisma.image.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ImageUpdateArgs>(args: SelectSubset<T, ImageUpdateArgs<ExtArgs>>): Prisma__ImageClient<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Images.
     * @param {ImageDeleteManyArgs} args - Arguments to filter Images to delete.
     * @example
     * // Delete a few Images
     * const { count } = await prisma.image.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ImageDeleteManyArgs>(args?: SelectSubset<T, ImageDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Images.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ImageUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Images
     * const image = await prisma.image.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ImageUpdateManyArgs>(args: SelectSubset<T, ImageUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Image.
     * @param {ImageUpsertArgs} args - Arguments to update or create a Image.
     * @example
     * // Update or create a Image
     * const image = await prisma.image.upsert({
     *   create: {
     *     // ... data to create a Image
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Image we want to update
     *   }
     * })
     */
    upsert<T extends ImageUpsertArgs>(args: SelectSubset<T, ImageUpsertArgs<ExtArgs>>): Prisma__ImageClient<$Result.GetResult<Prisma.$ImagePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Images.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ImageCountArgs} args - Arguments to filter Images to count.
     * @example
     * // Count the number of Images
     * const count = await prisma.image.count({
     *   where: {
     *     // ... the filter for the Images we want to count
     *   }
     * })
    **/
    count<T extends ImageCountArgs>(
      args?: Subset<T, ImageCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ImageCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Image.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ImageAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ImageAggregateArgs>(args: Subset<T, ImageAggregateArgs>): Prisma.PrismaPromise<GetImageAggregateType<T>>

    /**
     * Group by Image.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ImageGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ImageGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ImageGroupByArgs['orderBy'] }
        : { orderBy?: ImageGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ImageGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetImageGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Image model
   */
  readonly fields: ImageFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Image.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ImageClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    artwork<T extends Image$artworkArgs<ExtArgs> = {}>(args?: Subset<T, Image$artworkArgs<ExtArgs>>): Prisma__ArtworkClient<$Result.GetResult<Prisma.$ArtworkPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Image model
   */ 
  interface ImageFieldRefs {
    readonly id: FieldRef<"Image", 'Int'>
    readonly path: FieldRef<"Image", 'String'>
    readonly width: FieldRef<"Image", 'Int'>
    readonly height: FieldRef<"Image", 'Int'>
    readonly size: FieldRef<"Image", 'Int'>
    readonly sortOrder: FieldRef<"Image", 'Int'>
    readonly artworkId: FieldRef<"Image", 'Int'>
    readonly createdAt: FieldRef<"Image", 'DateTime'>
    readonly updatedAt: FieldRef<"Image", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Image findUnique
   */
  export type ImageFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    /**
     * Filter, which Image to fetch.
     */
    where: ImageWhereUniqueInput
  }

  /**
   * Image findUniqueOrThrow
   */
  export type ImageFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    /**
     * Filter, which Image to fetch.
     */
    where: ImageWhereUniqueInput
  }

  /**
   * Image findFirst
   */
  export type ImageFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    /**
     * Filter, which Image to fetch.
     */
    where?: ImageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Images to fetch.
     */
    orderBy?: ImageOrderByWithRelationInput | ImageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Images.
     */
    cursor?: ImageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Images from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Images.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Images.
     */
    distinct?: ImageScalarFieldEnum | ImageScalarFieldEnum[]
  }

  /**
   * Image findFirstOrThrow
   */
  export type ImageFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    /**
     * Filter, which Image to fetch.
     */
    where?: ImageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Images to fetch.
     */
    orderBy?: ImageOrderByWithRelationInput | ImageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Images.
     */
    cursor?: ImageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Images from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Images.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Images.
     */
    distinct?: ImageScalarFieldEnum | ImageScalarFieldEnum[]
  }

  /**
   * Image findMany
   */
  export type ImageFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    /**
     * Filter, which Images to fetch.
     */
    where?: ImageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Images to fetch.
     */
    orderBy?: ImageOrderByWithRelationInput | ImageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Images.
     */
    cursor?: ImageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Images from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Images.
     */
    skip?: number
    distinct?: ImageScalarFieldEnum | ImageScalarFieldEnum[]
  }

  /**
   * Image create
   */
  export type ImageCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    /**
     * The data needed to create a Image.
     */
    data: XOR<ImageCreateInput, ImageUncheckedCreateInput>
  }

  /**
   * Image createMany
   */
  export type ImageCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Images.
     */
    data: ImageCreateManyInput | ImageCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Image createManyAndReturn
   */
  export type ImageCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Images.
     */
    data: ImageCreateManyInput | ImageCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Image update
   */
  export type ImageUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    /**
     * The data needed to update a Image.
     */
    data: XOR<ImageUpdateInput, ImageUncheckedUpdateInput>
    /**
     * Choose, which Image to update.
     */
    where: ImageWhereUniqueInput
  }

  /**
   * Image updateMany
   */
  export type ImageUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Images.
     */
    data: XOR<ImageUpdateManyMutationInput, ImageUncheckedUpdateManyInput>
    /**
     * Filter which Images to update
     */
    where?: ImageWhereInput
  }

  /**
   * Image upsert
   */
  export type ImageUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    /**
     * The filter to search for the Image to update in case it exists.
     */
    where: ImageWhereUniqueInput
    /**
     * In case the Image found by the `where` argument doesn't exist, create a new Image with this data.
     */
    create: XOR<ImageCreateInput, ImageUncheckedCreateInput>
    /**
     * In case the Image was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ImageUpdateInput, ImageUncheckedUpdateInput>
  }

  /**
   * Image delete
   */
  export type ImageDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
    /**
     * Filter which Image to delete.
     */
    where: ImageWhereUniqueInput
  }

  /**
   * Image deleteMany
   */
  export type ImageDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Images to delete
     */
    where?: ImageWhereInput
  }

  /**
   * Image.artwork
   */
  export type Image$artworkArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Artwork
     */
    select?: ArtworkSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ArtworkInclude<ExtArgs> | null
    where?: ArtworkWhereInput
  }

  /**
   * Image without action
   */
  export type ImageDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Image
     */
    select?: ImageSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ImageInclude<ExtArgs> | null
  }


  /**
   * Model User
   */

  export type AggregateUser = {
    _count: UserCountAggregateOutputType | null
    _avg: UserAvgAggregateOutputType | null
    _sum: UserSumAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  export type UserAvgAggregateOutputType = {
    id: number | null
  }

  export type UserSumAggregateOutputType = {
    id: number | null
  }

  export type UserMinAggregateOutputType = {
    id: number | null
    username: string | null
    password: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserMaxAggregateOutputType = {
    id: number | null
    username: string | null
    password: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserCountAggregateOutputType = {
    id: number
    username: number
    password: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type UserAvgAggregateInputType = {
    id?: true
  }

  export type UserSumAggregateInputType = {
    id?: true
  }

  export type UserMinAggregateInputType = {
    id?: true
    username?: true
    password?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserMaxAggregateInputType = {
    id?: true
    username?: true
    password?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserCountAggregateInputType = {
    id?: true
    username?: true
    password?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type UserAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which User to aggregate.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Users
    **/
    _count?: true | UserCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: UserAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: UserSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserMaxAggregateInputType
  }

  export type GetUserAggregateType<T extends UserAggregateArgs> = {
        [P in keyof T & keyof AggregateUser]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUser[P]>
      : GetScalarType<T[P], AggregateUser[P]>
  }




  export type UserGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserWhereInput
    orderBy?: UserOrderByWithAggregationInput | UserOrderByWithAggregationInput[]
    by: UserScalarFieldEnum[] | UserScalarFieldEnum
    having?: UserScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserCountAggregateInputType | true
    _avg?: UserAvgAggregateInputType
    _sum?: UserSumAggregateInputType
    _min?: UserMinAggregateInputType
    _max?: UserMaxAggregateInputType
  }

  export type UserGroupByOutputType = {
    id: number
    username: string
    password: string
    createdAt: Date
    updatedAt: Date
    _count: UserCountAggregateOutputType | null
    _avg: UserAvgAggregateOutputType | null
    _sum: UserSumAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  type GetUserGroupByPayload<T extends UserGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserGroupByOutputType[P]>
            : GetScalarType<T[P], UserGroupByOutputType[P]>
        }
      >
    >


  export type UserSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    username?: boolean
    password?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["user"]>

  export type UserSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    username?: boolean
    password?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["user"]>

  export type UserSelectScalar = {
    id?: boolean
    username?: boolean
    password?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $UserPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "User"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: number
      username: string
      password: string
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["user"]>
    composites: {}
  }

  type UserGetPayload<S extends boolean | null | undefined | UserDefaultArgs> = $Result.GetResult<Prisma.$UserPayload, S>

  type UserCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<UserFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: UserCountAggregateInputType | true
    }

  export interface UserDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['User'], meta: { name: 'User' } }
    /**
     * Find zero or one User that matches the filter.
     * @param {UserFindUniqueArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends UserFindUniqueArgs>(args: SelectSubset<T, UserFindUniqueArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one User that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {UserFindUniqueOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends UserFindUniqueOrThrowArgs>(args: SelectSubset<T, UserFindUniqueOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first User that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends UserFindFirstArgs>(args?: SelectSubset<T, UserFindFirstArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first User that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends UserFindFirstOrThrowArgs>(args?: SelectSubset<T, UserFindFirstOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Users that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Users
     * const users = await prisma.user.findMany()
     * 
     * // Get first 10 Users
     * const users = await prisma.user.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const userWithIdOnly = await prisma.user.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends UserFindManyArgs>(args?: SelectSubset<T, UserFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a User.
     * @param {UserCreateArgs} args - Arguments to create a User.
     * @example
     * // Create one User
     * const User = await prisma.user.create({
     *   data: {
     *     // ... data to create a User
     *   }
     * })
     * 
     */
    create<T extends UserCreateArgs>(args: SelectSubset<T, UserCreateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Users.
     * @param {UserCreateManyArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends UserCreateManyArgs>(args?: SelectSubset<T, UserCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Users and returns the data saved in the database.
     * @param {UserCreateManyAndReturnArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Users and only return the `id`
     * const userWithIdOnly = await prisma.user.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends UserCreateManyAndReturnArgs>(args?: SelectSubset<T, UserCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a User.
     * @param {UserDeleteArgs} args - Arguments to delete one User.
     * @example
     * // Delete one User
     * const User = await prisma.user.delete({
     *   where: {
     *     // ... filter to delete one User
     *   }
     * })
     * 
     */
    delete<T extends UserDeleteArgs>(args: SelectSubset<T, UserDeleteArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one User.
     * @param {UserUpdateArgs} args - Arguments to update one User.
     * @example
     * // Update one User
     * const user = await prisma.user.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends UserUpdateArgs>(args: SelectSubset<T, UserUpdateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Users.
     * @param {UserDeleteManyArgs} args - Arguments to filter Users to delete.
     * @example
     * // Delete a few Users
     * const { count } = await prisma.user.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends UserDeleteManyArgs>(args?: SelectSubset<T, UserDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Users
     * const user = await prisma.user.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends UserUpdateManyArgs>(args: SelectSubset<T, UserUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one User.
     * @param {UserUpsertArgs} args - Arguments to update or create a User.
     * @example
     * // Update or create a User
     * const user = await prisma.user.upsert({
     *   create: {
     *     // ... data to create a User
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the User we want to update
     *   }
     * })
     */
    upsert<T extends UserUpsertArgs>(args: SelectSubset<T, UserUpsertArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserCountArgs} args - Arguments to filter Users to count.
     * @example
     * // Count the number of Users
     * const count = await prisma.user.count({
     *   where: {
     *     // ... the filter for the Users we want to count
     *   }
     * })
    **/
    count<T extends UserCountArgs>(
      args?: Subset<T, UserCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends UserAggregateArgs>(args: Subset<T, UserAggregateArgs>): Prisma.PrismaPromise<GetUserAggregateType<T>>

    /**
     * Group by User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends UserGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserGroupByArgs['orderBy'] }
        : { orderBy?: UserGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, UserGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the User model
   */
  readonly fields: UserFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for User.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the User model
   */ 
  interface UserFieldRefs {
    readonly id: FieldRef<"User", 'Int'>
    readonly username: FieldRef<"User", 'String'>
    readonly password: FieldRef<"User", 'String'>
    readonly createdAt: FieldRef<"User", 'DateTime'>
    readonly updatedAt: FieldRef<"User", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * User findUnique
   */
  export type UserFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findUniqueOrThrow
   */
  export type UserFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findFirst
   */
  export type UserFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findFirstOrThrow
   */
  export type UserFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findMany
   */
  export type UserFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Filter, which Users to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User create
   */
  export type UserCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * The data needed to create a User.
     */
    data: XOR<UserCreateInput, UserUncheckedCreateInput>
  }

  /**
   * User createMany
   */
  export type UserCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * User createManyAndReturn
   */
  export type UserCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * User update
   */
  export type UserUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * The data needed to update a User.
     */
    data: XOR<UserUpdateInput, UserUncheckedUpdateInput>
    /**
     * Choose, which User to update.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User updateMany
   */
  export type UserUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Users.
     */
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyInput>
    /**
     * Filter which Users to update
     */
    where?: UserWhereInput
  }

  /**
   * User upsert
   */
  export type UserUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * The filter to search for the User to update in case it exists.
     */
    where: UserWhereUniqueInput
    /**
     * In case the User found by the `where` argument doesn't exist, create a new User with this data.
     */
    create: XOR<UserCreateInput, UserUncheckedCreateInput>
    /**
     * In case the User was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserUpdateInput, UserUncheckedUpdateInput>
  }

  /**
   * User delete
   */
  export type UserDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Filter which User to delete.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User deleteMany
   */
  export type UserDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Users to delete
     */
    where?: UserWhereInput
  }

  /**
   * User without action
   */
  export type UserDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
  }


  /**
   * Model Setting
   */

  export type AggregateSetting = {
    _count: SettingCountAggregateOutputType | null
    _avg: SettingAvgAggregateOutputType | null
    _sum: SettingSumAggregateOutputType | null
    _min: SettingMinAggregateOutputType | null
    _max: SettingMaxAggregateOutputType | null
  }

  export type SettingAvgAggregateOutputType = {
    id: number | null
  }

  export type SettingSumAggregateOutputType = {
    id: number | null
  }

  export type SettingMinAggregateOutputType = {
    id: number | null
    key: string | null
    value: string | null
    type: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type SettingMaxAggregateOutputType = {
    id: number | null
    key: string | null
    value: string | null
    type: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type SettingCountAggregateOutputType = {
    id: number
    key: number
    value: number
    type: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type SettingAvgAggregateInputType = {
    id?: true
  }

  export type SettingSumAggregateInputType = {
    id?: true
  }

  export type SettingMinAggregateInputType = {
    id?: true
    key?: true
    value?: true
    type?: true
    createdAt?: true
    updatedAt?: true
  }

  export type SettingMaxAggregateInputType = {
    id?: true
    key?: true
    value?: true
    type?: true
    createdAt?: true
    updatedAt?: true
  }

  export type SettingCountAggregateInputType = {
    id?: true
    key?: true
    value?: true
    type?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type SettingAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Setting to aggregate.
     */
    where?: SettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Settings to fetch.
     */
    orderBy?: SettingOrderByWithRelationInput | SettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Settings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Settings
    **/
    _count?: true | SettingCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: SettingAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: SettingSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SettingMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SettingMaxAggregateInputType
  }

  export type GetSettingAggregateType<T extends SettingAggregateArgs> = {
        [P in keyof T & keyof AggregateSetting]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSetting[P]>
      : GetScalarType<T[P], AggregateSetting[P]>
  }




  export type SettingGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SettingWhereInput
    orderBy?: SettingOrderByWithAggregationInput | SettingOrderByWithAggregationInput[]
    by: SettingScalarFieldEnum[] | SettingScalarFieldEnum
    having?: SettingScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SettingCountAggregateInputType | true
    _avg?: SettingAvgAggregateInputType
    _sum?: SettingSumAggregateInputType
    _min?: SettingMinAggregateInputType
    _max?: SettingMaxAggregateInputType
  }

  export type SettingGroupByOutputType = {
    id: number
    key: string
    value: string | null
    type: string
    createdAt: Date
    updatedAt: Date
    _count: SettingCountAggregateOutputType | null
    _avg: SettingAvgAggregateOutputType | null
    _sum: SettingSumAggregateOutputType | null
    _min: SettingMinAggregateOutputType | null
    _max: SettingMaxAggregateOutputType | null
  }

  type GetSettingGroupByPayload<T extends SettingGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SettingGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SettingGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SettingGroupByOutputType[P]>
            : GetScalarType<T[P], SettingGroupByOutputType[P]>
        }
      >
    >


  export type SettingSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    key?: boolean
    value?: boolean
    type?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["setting"]>

  export type SettingSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    key?: boolean
    value?: boolean
    type?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["setting"]>

  export type SettingSelectScalar = {
    id?: boolean
    key?: boolean
    value?: boolean
    type?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $SettingPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Setting"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: number
      key: string
      value: string | null
      type: string
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["setting"]>
    composites: {}
  }

  type SettingGetPayload<S extends boolean | null | undefined | SettingDefaultArgs> = $Result.GetResult<Prisma.$SettingPayload, S>

  type SettingCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<SettingFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: SettingCountAggregateInputType | true
    }

  export interface SettingDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Setting'], meta: { name: 'Setting' } }
    /**
     * Find zero or one Setting that matches the filter.
     * @param {SettingFindUniqueArgs} args - Arguments to find a Setting
     * @example
     * // Get one Setting
     * const setting = await prisma.setting.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SettingFindUniqueArgs>(args: SelectSubset<T, SettingFindUniqueArgs<ExtArgs>>): Prisma__SettingClient<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Setting that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {SettingFindUniqueOrThrowArgs} args - Arguments to find a Setting
     * @example
     * // Get one Setting
     * const setting = await prisma.setting.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SettingFindUniqueOrThrowArgs>(args: SelectSubset<T, SettingFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SettingClient<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Setting that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingFindFirstArgs} args - Arguments to find a Setting
     * @example
     * // Get one Setting
     * const setting = await prisma.setting.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SettingFindFirstArgs>(args?: SelectSubset<T, SettingFindFirstArgs<ExtArgs>>): Prisma__SettingClient<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Setting that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingFindFirstOrThrowArgs} args - Arguments to find a Setting
     * @example
     * // Get one Setting
     * const setting = await prisma.setting.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SettingFindFirstOrThrowArgs>(args?: SelectSubset<T, SettingFindFirstOrThrowArgs<ExtArgs>>): Prisma__SettingClient<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Settings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Settings
     * const settings = await prisma.setting.findMany()
     * 
     * // Get first 10 Settings
     * const settings = await prisma.setting.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const settingWithIdOnly = await prisma.setting.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends SettingFindManyArgs>(args?: SelectSubset<T, SettingFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Setting.
     * @param {SettingCreateArgs} args - Arguments to create a Setting.
     * @example
     * // Create one Setting
     * const Setting = await prisma.setting.create({
     *   data: {
     *     // ... data to create a Setting
     *   }
     * })
     * 
     */
    create<T extends SettingCreateArgs>(args: SelectSubset<T, SettingCreateArgs<ExtArgs>>): Prisma__SettingClient<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Settings.
     * @param {SettingCreateManyArgs} args - Arguments to create many Settings.
     * @example
     * // Create many Settings
     * const setting = await prisma.setting.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SettingCreateManyArgs>(args?: SelectSubset<T, SettingCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Settings and returns the data saved in the database.
     * @param {SettingCreateManyAndReturnArgs} args - Arguments to create many Settings.
     * @example
     * // Create many Settings
     * const setting = await prisma.setting.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Settings and only return the `id`
     * const settingWithIdOnly = await prisma.setting.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SettingCreateManyAndReturnArgs>(args?: SelectSubset<T, SettingCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Setting.
     * @param {SettingDeleteArgs} args - Arguments to delete one Setting.
     * @example
     * // Delete one Setting
     * const Setting = await prisma.setting.delete({
     *   where: {
     *     // ... filter to delete one Setting
     *   }
     * })
     * 
     */
    delete<T extends SettingDeleteArgs>(args: SelectSubset<T, SettingDeleteArgs<ExtArgs>>): Prisma__SettingClient<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Setting.
     * @param {SettingUpdateArgs} args - Arguments to update one Setting.
     * @example
     * // Update one Setting
     * const setting = await prisma.setting.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SettingUpdateArgs>(args: SelectSubset<T, SettingUpdateArgs<ExtArgs>>): Prisma__SettingClient<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Settings.
     * @param {SettingDeleteManyArgs} args - Arguments to filter Settings to delete.
     * @example
     * // Delete a few Settings
     * const { count } = await prisma.setting.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SettingDeleteManyArgs>(args?: SelectSubset<T, SettingDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Settings
     * const setting = await prisma.setting.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SettingUpdateManyArgs>(args: SelectSubset<T, SettingUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Setting.
     * @param {SettingUpsertArgs} args - Arguments to update or create a Setting.
     * @example
     * // Update or create a Setting
     * const setting = await prisma.setting.upsert({
     *   create: {
     *     // ... data to create a Setting
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Setting we want to update
     *   }
     * })
     */
    upsert<T extends SettingUpsertArgs>(args: SelectSubset<T, SettingUpsertArgs<ExtArgs>>): Prisma__SettingClient<$Result.GetResult<Prisma.$SettingPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingCountArgs} args - Arguments to filter Settings to count.
     * @example
     * // Count the number of Settings
     * const count = await prisma.setting.count({
     *   where: {
     *     // ... the filter for the Settings we want to count
     *   }
     * })
    **/
    count<T extends SettingCountArgs>(
      args?: Subset<T, SettingCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SettingCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Setting.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SettingAggregateArgs>(args: Subset<T, SettingAggregateArgs>): Prisma.PrismaPromise<GetSettingAggregateType<T>>

    /**
     * Group by Setting.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SettingGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SettingGroupByArgs['orderBy'] }
        : { orderBy?: SettingGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SettingGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSettingGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Setting model
   */
  readonly fields: SettingFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Setting.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SettingClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Setting model
   */ 
  interface SettingFieldRefs {
    readonly id: FieldRef<"Setting", 'Int'>
    readonly key: FieldRef<"Setting", 'String'>
    readonly value: FieldRef<"Setting", 'String'>
    readonly type: FieldRef<"Setting", 'String'>
    readonly createdAt: FieldRef<"Setting", 'DateTime'>
    readonly updatedAt: FieldRef<"Setting", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Setting findUnique
   */
  export type SettingFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
    /**
     * Filter, which Setting to fetch.
     */
    where: SettingWhereUniqueInput
  }

  /**
   * Setting findUniqueOrThrow
   */
  export type SettingFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
    /**
     * Filter, which Setting to fetch.
     */
    where: SettingWhereUniqueInput
  }

  /**
   * Setting findFirst
   */
  export type SettingFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
    /**
     * Filter, which Setting to fetch.
     */
    where?: SettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Settings to fetch.
     */
    orderBy?: SettingOrderByWithRelationInput | SettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Settings.
     */
    cursor?: SettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Settings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Settings.
     */
    distinct?: SettingScalarFieldEnum | SettingScalarFieldEnum[]
  }

  /**
   * Setting findFirstOrThrow
   */
  export type SettingFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
    /**
     * Filter, which Setting to fetch.
     */
    where?: SettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Settings to fetch.
     */
    orderBy?: SettingOrderByWithRelationInput | SettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Settings.
     */
    cursor?: SettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Settings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Settings.
     */
    distinct?: SettingScalarFieldEnum | SettingScalarFieldEnum[]
  }

  /**
   * Setting findMany
   */
  export type SettingFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
    /**
     * Filter, which Settings to fetch.
     */
    where?: SettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Settings to fetch.
     */
    orderBy?: SettingOrderByWithRelationInput | SettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Settings.
     */
    cursor?: SettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Settings.
     */
    skip?: number
    distinct?: SettingScalarFieldEnum | SettingScalarFieldEnum[]
  }

  /**
   * Setting create
   */
  export type SettingCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
    /**
     * The data needed to create a Setting.
     */
    data: XOR<SettingCreateInput, SettingUncheckedCreateInput>
  }

  /**
   * Setting createMany
   */
  export type SettingCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Settings.
     */
    data: SettingCreateManyInput | SettingCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Setting createManyAndReturn
   */
  export type SettingCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Settings.
     */
    data: SettingCreateManyInput | SettingCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Setting update
   */
  export type SettingUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
    /**
     * The data needed to update a Setting.
     */
    data: XOR<SettingUpdateInput, SettingUncheckedUpdateInput>
    /**
     * Choose, which Setting to update.
     */
    where: SettingWhereUniqueInput
  }

  /**
   * Setting updateMany
   */
  export type SettingUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Settings.
     */
    data: XOR<SettingUpdateManyMutationInput, SettingUncheckedUpdateManyInput>
    /**
     * Filter which Settings to update
     */
    where?: SettingWhereInput
  }

  /**
   * Setting upsert
   */
  export type SettingUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
    /**
     * The filter to search for the Setting to update in case it exists.
     */
    where: SettingWhereUniqueInput
    /**
     * In case the Setting found by the `where` argument doesn't exist, create a new Setting with this data.
     */
    create: XOR<SettingCreateInput, SettingUncheckedCreateInput>
    /**
     * In case the Setting was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SettingUpdateInput, SettingUncheckedUpdateInput>
  }

  /**
   * Setting delete
   */
  export type SettingDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
    /**
     * Filter which Setting to delete.
     */
    where: SettingWhereUniqueInput
  }

  /**
   * Setting deleteMany
   */
  export type SettingDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Settings to delete
     */
    where?: SettingWhereInput
  }

  /**
   * Setting without action
   */
  export type SettingDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Setting
     */
    select?: SettingSelect<ExtArgs> | null
  }


  /**
   * Model TriggerLog
   */

  export type AggregateTriggerLog = {
    _count: TriggerLogCountAggregateOutputType | null
    _avg: TriggerLogAvgAggregateOutputType | null
    _sum: TriggerLogSumAggregateOutputType | null
    _min: TriggerLogMinAggregateOutputType | null
    _max: TriggerLogMaxAggregateOutputType | null
  }

  export type TriggerLogAvgAggregateOutputType = {
    id: number | null
    record_id: number | null
    old_value: number | null
    new_value: number | null
  }

  export type TriggerLogSumAggregateOutputType = {
    id: number | null
    record_id: number | null
    old_value: number | null
    new_value: number | null
  }

  export type TriggerLogMinAggregateOutputType = {
    id: number | null
    operation: string | null
    table_name: string | null
    record_id: number | null
    old_value: number | null
    new_value: number | null
    error_message: string | null
    created_at: Date | null
  }

  export type TriggerLogMaxAggregateOutputType = {
    id: number | null
    operation: string | null
    table_name: string | null
    record_id: number | null
    old_value: number | null
    new_value: number | null
    error_message: string | null
    created_at: Date | null
  }

  export type TriggerLogCountAggregateOutputType = {
    id: number
    operation: number
    table_name: number
    record_id: number
    old_value: number
    new_value: number
    error_message: number
    created_at: number
    _all: number
  }


  export type TriggerLogAvgAggregateInputType = {
    id?: true
    record_id?: true
    old_value?: true
    new_value?: true
  }

  export type TriggerLogSumAggregateInputType = {
    id?: true
    record_id?: true
    old_value?: true
    new_value?: true
  }

  export type TriggerLogMinAggregateInputType = {
    id?: true
    operation?: true
    table_name?: true
    record_id?: true
    old_value?: true
    new_value?: true
    error_message?: true
    created_at?: true
  }

  export type TriggerLogMaxAggregateInputType = {
    id?: true
    operation?: true
    table_name?: true
    record_id?: true
    old_value?: true
    new_value?: true
    error_message?: true
    created_at?: true
  }

  export type TriggerLogCountAggregateInputType = {
    id?: true
    operation?: true
    table_name?: true
    record_id?: true
    old_value?: true
    new_value?: true
    error_message?: true
    created_at?: true
    _all?: true
  }

  export type TriggerLogAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TriggerLog to aggregate.
     */
    where?: TriggerLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TriggerLogs to fetch.
     */
    orderBy?: TriggerLogOrderByWithRelationInput | TriggerLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TriggerLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TriggerLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TriggerLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TriggerLogs
    **/
    _count?: true | TriggerLogCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: TriggerLogAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: TriggerLogSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TriggerLogMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TriggerLogMaxAggregateInputType
  }

  export type GetTriggerLogAggregateType<T extends TriggerLogAggregateArgs> = {
        [P in keyof T & keyof AggregateTriggerLog]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTriggerLog[P]>
      : GetScalarType<T[P], AggregateTriggerLog[P]>
  }




  export type TriggerLogGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TriggerLogWhereInput
    orderBy?: TriggerLogOrderByWithAggregationInput | TriggerLogOrderByWithAggregationInput[]
    by: TriggerLogScalarFieldEnum[] | TriggerLogScalarFieldEnum
    having?: TriggerLogScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TriggerLogCountAggregateInputType | true
    _avg?: TriggerLogAvgAggregateInputType
    _sum?: TriggerLogSumAggregateInputType
    _min?: TriggerLogMinAggregateInputType
    _max?: TriggerLogMaxAggregateInputType
  }

  export type TriggerLogGroupByOutputType = {
    id: number
    operation: string
    table_name: string
    record_id: number | null
    old_value: number | null
    new_value: number | null
    error_message: string | null
    created_at: Date
    _count: TriggerLogCountAggregateOutputType | null
    _avg: TriggerLogAvgAggregateOutputType | null
    _sum: TriggerLogSumAggregateOutputType | null
    _min: TriggerLogMinAggregateOutputType | null
    _max: TriggerLogMaxAggregateOutputType | null
  }

  type GetTriggerLogGroupByPayload<T extends TriggerLogGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TriggerLogGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TriggerLogGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TriggerLogGroupByOutputType[P]>
            : GetScalarType<T[P], TriggerLogGroupByOutputType[P]>
        }
      >
    >


  export type TriggerLogSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    operation?: boolean
    table_name?: boolean
    record_id?: boolean
    old_value?: boolean
    new_value?: boolean
    error_message?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["triggerLog"]>

  export type TriggerLogSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    operation?: boolean
    table_name?: boolean
    record_id?: boolean
    old_value?: boolean
    new_value?: boolean
    error_message?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["triggerLog"]>

  export type TriggerLogSelectScalar = {
    id?: boolean
    operation?: boolean
    table_name?: boolean
    record_id?: boolean
    old_value?: boolean
    new_value?: boolean
    error_message?: boolean
    created_at?: boolean
  }


  export type $TriggerLogPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TriggerLog"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: number
      operation: string
      table_name: string
      record_id: number | null
      old_value: number | null
      new_value: number | null
      error_message: string | null
      created_at: Date
    }, ExtArgs["result"]["triggerLog"]>
    composites: {}
  }

  type TriggerLogGetPayload<S extends boolean | null | undefined | TriggerLogDefaultArgs> = $Result.GetResult<Prisma.$TriggerLogPayload, S>

  type TriggerLogCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TriggerLogFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TriggerLogCountAggregateInputType | true
    }

  export interface TriggerLogDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TriggerLog'], meta: { name: 'TriggerLog' } }
    /**
     * Find zero or one TriggerLog that matches the filter.
     * @param {TriggerLogFindUniqueArgs} args - Arguments to find a TriggerLog
     * @example
     * // Get one TriggerLog
     * const triggerLog = await prisma.triggerLog.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TriggerLogFindUniqueArgs>(args: SelectSubset<T, TriggerLogFindUniqueArgs<ExtArgs>>): Prisma__TriggerLogClient<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one TriggerLog that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TriggerLogFindUniqueOrThrowArgs} args - Arguments to find a TriggerLog
     * @example
     * // Get one TriggerLog
     * const triggerLog = await prisma.triggerLog.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TriggerLogFindUniqueOrThrowArgs>(args: SelectSubset<T, TriggerLogFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TriggerLogClient<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first TriggerLog that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TriggerLogFindFirstArgs} args - Arguments to find a TriggerLog
     * @example
     * // Get one TriggerLog
     * const triggerLog = await prisma.triggerLog.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TriggerLogFindFirstArgs>(args?: SelectSubset<T, TriggerLogFindFirstArgs<ExtArgs>>): Prisma__TriggerLogClient<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first TriggerLog that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TriggerLogFindFirstOrThrowArgs} args - Arguments to find a TriggerLog
     * @example
     * // Get one TriggerLog
     * const triggerLog = await prisma.triggerLog.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TriggerLogFindFirstOrThrowArgs>(args?: SelectSubset<T, TriggerLogFindFirstOrThrowArgs<ExtArgs>>): Prisma__TriggerLogClient<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more TriggerLogs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TriggerLogFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TriggerLogs
     * const triggerLogs = await prisma.triggerLog.findMany()
     * 
     * // Get first 10 TriggerLogs
     * const triggerLogs = await prisma.triggerLog.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const triggerLogWithIdOnly = await prisma.triggerLog.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TriggerLogFindManyArgs>(args?: SelectSubset<T, TriggerLogFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a TriggerLog.
     * @param {TriggerLogCreateArgs} args - Arguments to create a TriggerLog.
     * @example
     * // Create one TriggerLog
     * const TriggerLog = await prisma.triggerLog.create({
     *   data: {
     *     // ... data to create a TriggerLog
     *   }
     * })
     * 
     */
    create<T extends TriggerLogCreateArgs>(args: SelectSubset<T, TriggerLogCreateArgs<ExtArgs>>): Prisma__TriggerLogClient<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many TriggerLogs.
     * @param {TriggerLogCreateManyArgs} args - Arguments to create many TriggerLogs.
     * @example
     * // Create many TriggerLogs
     * const triggerLog = await prisma.triggerLog.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TriggerLogCreateManyArgs>(args?: SelectSubset<T, TriggerLogCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many TriggerLogs and returns the data saved in the database.
     * @param {TriggerLogCreateManyAndReturnArgs} args - Arguments to create many TriggerLogs.
     * @example
     * // Create many TriggerLogs
     * const triggerLog = await prisma.triggerLog.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many TriggerLogs and only return the `id`
     * const triggerLogWithIdOnly = await prisma.triggerLog.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TriggerLogCreateManyAndReturnArgs>(args?: SelectSubset<T, TriggerLogCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a TriggerLog.
     * @param {TriggerLogDeleteArgs} args - Arguments to delete one TriggerLog.
     * @example
     * // Delete one TriggerLog
     * const TriggerLog = await prisma.triggerLog.delete({
     *   where: {
     *     // ... filter to delete one TriggerLog
     *   }
     * })
     * 
     */
    delete<T extends TriggerLogDeleteArgs>(args: SelectSubset<T, TriggerLogDeleteArgs<ExtArgs>>): Prisma__TriggerLogClient<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one TriggerLog.
     * @param {TriggerLogUpdateArgs} args - Arguments to update one TriggerLog.
     * @example
     * // Update one TriggerLog
     * const triggerLog = await prisma.triggerLog.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TriggerLogUpdateArgs>(args: SelectSubset<T, TriggerLogUpdateArgs<ExtArgs>>): Prisma__TriggerLogClient<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more TriggerLogs.
     * @param {TriggerLogDeleteManyArgs} args - Arguments to filter TriggerLogs to delete.
     * @example
     * // Delete a few TriggerLogs
     * const { count } = await prisma.triggerLog.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TriggerLogDeleteManyArgs>(args?: SelectSubset<T, TriggerLogDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TriggerLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TriggerLogUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TriggerLogs
     * const triggerLog = await prisma.triggerLog.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TriggerLogUpdateManyArgs>(args: SelectSubset<T, TriggerLogUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one TriggerLog.
     * @param {TriggerLogUpsertArgs} args - Arguments to update or create a TriggerLog.
     * @example
     * // Update or create a TriggerLog
     * const triggerLog = await prisma.triggerLog.upsert({
     *   create: {
     *     // ... data to create a TriggerLog
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TriggerLog we want to update
     *   }
     * })
     */
    upsert<T extends TriggerLogUpsertArgs>(args: SelectSubset<T, TriggerLogUpsertArgs<ExtArgs>>): Prisma__TriggerLogClient<$Result.GetResult<Prisma.$TriggerLogPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of TriggerLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TriggerLogCountArgs} args - Arguments to filter TriggerLogs to count.
     * @example
     * // Count the number of TriggerLogs
     * const count = await prisma.triggerLog.count({
     *   where: {
     *     // ... the filter for the TriggerLogs we want to count
     *   }
     * })
    **/
    count<T extends TriggerLogCountArgs>(
      args?: Subset<T, TriggerLogCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TriggerLogCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TriggerLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TriggerLogAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TriggerLogAggregateArgs>(args: Subset<T, TriggerLogAggregateArgs>): Prisma.PrismaPromise<GetTriggerLogAggregateType<T>>

    /**
     * Group by TriggerLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TriggerLogGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TriggerLogGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TriggerLogGroupByArgs['orderBy'] }
        : { orderBy?: TriggerLogGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TriggerLogGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTriggerLogGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TriggerLog model
   */
  readonly fields: TriggerLogFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TriggerLog.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TriggerLogClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the TriggerLog model
   */ 
  interface TriggerLogFieldRefs {
    readonly id: FieldRef<"TriggerLog", 'Int'>
    readonly operation: FieldRef<"TriggerLog", 'String'>
    readonly table_name: FieldRef<"TriggerLog", 'String'>
    readonly record_id: FieldRef<"TriggerLog", 'Int'>
    readonly old_value: FieldRef<"TriggerLog", 'Int'>
    readonly new_value: FieldRef<"TriggerLog", 'Int'>
    readonly error_message: FieldRef<"TriggerLog", 'String'>
    readonly created_at: FieldRef<"TriggerLog", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * TriggerLog findUnique
   */
  export type TriggerLogFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
    /**
     * Filter, which TriggerLog to fetch.
     */
    where: TriggerLogWhereUniqueInput
  }

  /**
   * TriggerLog findUniqueOrThrow
   */
  export type TriggerLogFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
    /**
     * Filter, which TriggerLog to fetch.
     */
    where: TriggerLogWhereUniqueInput
  }

  /**
   * TriggerLog findFirst
   */
  export type TriggerLogFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
    /**
     * Filter, which TriggerLog to fetch.
     */
    where?: TriggerLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TriggerLogs to fetch.
     */
    orderBy?: TriggerLogOrderByWithRelationInput | TriggerLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TriggerLogs.
     */
    cursor?: TriggerLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TriggerLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TriggerLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TriggerLogs.
     */
    distinct?: TriggerLogScalarFieldEnum | TriggerLogScalarFieldEnum[]
  }

  /**
   * TriggerLog findFirstOrThrow
   */
  export type TriggerLogFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
    /**
     * Filter, which TriggerLog to fetch.
     */
    where?: TriggerLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TriggerLogs to fetch.
     */
    orderBy?: TriggerLogOrderByWithRelationInput | TriggerLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TriggerLogs.
     */
    cursor?: TriggerLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TriggerLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TriggerLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TriggerLogs.
     */
    distinct?: TriggerLogScalarFieldEnum | TriggerLogScalarFieldEnum[]
  }

  /**
   * TriggerLog findMany
   */
  export type TriggerLogFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
    /**
     * Filter, which TriggerLogs to fetch.
     */
    where?: TriggerLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TriggerLogs to fetch.
     */
    orderBy?: TriggerLogOrderByWithRelationInput | TriggerLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TriggerLogs.
     */
    cursor?: TriggerLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TriggerLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TriggerLogs.
     */
    skip?: number
    distinct?: TriggerLogScalarFieldEnum | TriggerLogScalarFieldEnum[]
  }

  /**
   * TriggerLog create
   */
  export type TriggerLogCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
    /**
     * The data needed to create a TriggerLog.
     */
    data: XOR<TriggerLogCreateInput, TriggerLogUncheckedCreateInput>
  }

  /**
   * TriggerLog createMany
   */
  export type TriggerLogCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TriggerLogs.
     */
    data: TriggerLogCreateManyInput | TriggerLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TriggerLog createManyAndReturn
   */
  export type TriggerLogCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many TriggerLogs.
     */
    data: TriggerLogCreateManyInput | TriggerLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TriggerLog update
   */
  export type TriggerLogUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
    /**
     * The data needed to update a TriggerLog.
     */
    data: XOR<TriggerLogUpdateInput, TriggerLogUncheckedUpdateInput>
    /**
     * Choose, which TriggerLog to update.
     */
    where: TriggerLogWhereUniqueInput
  }

  /**
   * TriggerLog updateMany
   */
  export type TriggerLogUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TriggerLogs.
     */
    data: XOR<TriggerLogUpdateManyMutationInput, TriggerLogUncheckedUpdateManyInput>
    /**
     * Filter which TriggerLogs to update
     */
    where?: TriggerLogWhereInput
  }

  /**
   * TriggerLog upsert
   */
  export type TriggerLogUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
    /**
     * The filter to search for the TriggerLog to update in case it exists.
     */
    where: TriggerLogWhereUniqueInput
    /**
     * In case the TriggerLog found by the `where` argument doesn't exist, create a new TriggerLog with this data.
     */
    create: XOR<TriggerLogCreateInput, TriggerLogUncheckedCreateInput>
    /**
     * In case the TriggerLog was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TriggerLogUpdateInput, TriggerLogUncheckedUpdateInput>
  }

  /**
   * TriggerLog delete
   */
  export type TriggerLogDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
    /**
     * Filter which TriggerLog to delete.
     */
    where: TriggerLogWhereUniqueInput
  }

  /**
   * TriggerLog deleteMany
   */
  export type TriggerLogDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TriggerLogs to delete
     */
    where?: TriggerLogWhereInput
  }

  /**
   * TriggerLog without action
   */
  export type TriggerLogDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TriggerLog
     */
    select?: TriggerLogSelect<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const ArtistScalarFieldEnum: {
    id: 'id',
    name: 'name',
    username: 'username',
    userId: 'userId',
    bio: 'bio',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type ArtistScalarFieldEnum = (typeof ArtistScalarFieldEnum)[keyof typeof ArtistScalarFieldEnum]


  export const ArtworkScalarFieldEnum: {
    id: 'id',
    title: 'title',
    description: 'description',
    artistId: 'artistId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    descriptionLength: 'descriptionLength',
    directoryCreatedAt: 'directoryCreatedAt',
    imageCount: 'imageCount',
    bookmarkCount: 'bookmarkCount',
    externalId: 'externalId',
    isAiGenerated: 'isAiGenerated',
    originalUrl: 'originalUrl',
    size: 'size',
    sourceDate: 'sourceDate',
    sourceUrl: 'sourceUrl',
    thumbnailUrl: 'thumbnailUrl',
    xRestrict: 'xRestrict'
  };

  export type ArtworkScalarFieldEnum = (typeof ArtworkScalarFieldEnum)[keyof typeof ArtworkScalarFieldEnum]


  export const TagScalarFieldEnum: {
    id: 'id',
    name: 'name',
    name_zh: 'name_zh',
    description: 'description',
    artworkCount: 'artworkCount',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TagScalarFieldEnum = (typeof TagScalarFieldEnum)[keyof typeof TagScalarFieldEnum]


  export const ArtworkTagScalarFieldEnum: {
    id: 'id',
    artworkId: 'artworkId',
    tagId: 'tagId',
    createdAt: 'createdAt'
  };

  export type ArtworkTagScalarFieldEnum = (typeof ArtworkTagScalarFieldEnum)[keyof typeof ArtworkTagScalarFieldEnum]


  export const ImageScalarFieldEnum: {
    id: 'id',
    path: 'path',
    width: 'width',
    height: 'height',
    size: 'size',
    sortOrder: 'sortOrder',
    artworkId: 'artworkId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type ImageScalarFieldEnum = (typeof ImageScalarFieldEnum)[keyof typeof ImageScalarFieldEnum]


  export const UserScalarFieldEnum: {
    id: 'id',
    username: 'username',
    password: 'password',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type UserScalarFieldEnum = (typeof UserScalarFieldEnum)[keyof typeof UserScalarFieldEnum]


  export const SettingScalarFieldEnum: {
    id: 'id',
    key: 'key',
    value: 'value',
    type: 'type',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type SettingScalarFieldEnum = (typeof SettingScalarFieldEnum)[keyof typeof SettingScalarFieldEnum]


  export const TriggerLogScalarFieldEnum: {
    id: 'id',
    operation: 'operation',
    table_name: 'table_name',
    record_id: 'record_id',
    old_value: 'old_value',
    new_value: 'new_value',
    error_message: 'error_message',
    created_at: 'created_at'
  };

  export type TriggerLogScalarFieldEnum = (typeof TriggerLogScalarFieldEnum)[keyof typeof TriggerLogScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  export const ArtistOrderByRelevanceFieldEnum: {
    name: 'name',
    username: 'username',
    userId: 'userId',
    bio: 'bio'
  };

  export type ArtistOrderByRelevanceFieldEnum = (typeof ArtistOrderByRelevanceFieldEnum)[keyof typeof ArtistOrderByRelevanceFieldEnum]


  export const ArtworkOrderByRelevanceFieldEnum: {
    title: 'title',
    description: 'description',
    externalId: 'externalId',
    originalUrl: 'originalUrl',
    size: 'size',
    sourceUrl: 'sourceUrl',
    thumbnailUrl: 'thumbnailUrl',
    xRestrict: 'xRestrict'
  };

  export type ArtworkOrderByRelevanceFieldEnum = (typeof ArtworkOrderByRelevanceFieldEnum)[keyof typeof ArtworkOrderByRelevanceFieldEnum]


  export const TagOrderByRelevanceFieldEnum: {
    name: 'name',
    name_zh: 'name_zh',
    description: 'description'
  };

  export type TagOrderByRelevanceFieldEnum = (typeof TagOrderByRelevanceFieldEnum)[keyof typeof TagOrderByRelevanceFieldEnum]


  export const ImageOrderByRelevanceFieldEnum: {
    path: 'path'
  };

  export type ImageOrderByRelevanceFieldEnum = (typeof ImageOrderByRelevanceFieldEnum)[keyof typeof ImageOrderByRelevanceFieldEnum]


  export const UserOrderByRelevanceFieldEnum: {
    username: 'username',
    password: 'password'
  };

  export type UserOrderByRelevanceFieldEnum = (typeof UserOrderByRelevanceFieldEnum)[keyof typeof UserOrderByRelevanceFieldEnum]


  export const SettingOrderByRelevanceFieldEnum: {
    key: 'key',
    value: 'value',
    type: 'type'
  };

  export type SettingOrderByRelevanceFieldEnum = (typeof SettingOrderByRelevanceFieldEnum)[keyof typeof SettingOrderByRelevanceFieldEnum]


  export const TriggerLogOrderByRelevanceFieldEnum: {
    operation: 'operation',
    table_name: 'table_name',
    error_message: 'error_message'
  };

  export type TriggerLogOrderByRelevanceFieldEnum = (typeof TriggerLogOrderByRelevanceFieldEnum)[keyof typeof TriggerLogOrderByRelevanceFieldEnum]


  /**
   * Field references 
   */


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type ArtistWhereInput = {
    AND?: ArtistWhereInput | ArtistWhereInput[]
    OR?: ArtistWhereInput[]
    NOT?: ArtistWhereInput | ArtistWhereInput[]
    id?: IntFilter<"Artist"> | number
    name?: StringFilter<"Artist"> | string
    username?: StringNullableFilter<"Artist"> | string | null
    userId?: StringNullableFilter<"Artist"> | string | null
    bio?: StringNullableFilter<"Artist"> | string | null
    createdAt?: DateTimeFilter<"Artist"> | Date | string
    updatedAt?: DateTimeFilter<"Artist"> | Date | string
    artworks?: ArtworkListRelationFilter
  }

  export type ArtistOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    username?: SortOrderInput | SortOrder
    userId?: SortOrderInput | SortOrder
    bio?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    artworks?: ArtworkOrderByRelationAggregateInput
    _relevance?: ArtistOrderByRelevanceInput
  }

  export type ArtistWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    unique_username_userid?: ArtistUnique_username_useridCompoundUniqueInput
    AND?: ArtistWhereInput | ArtistWhereInput[]
    OR?: ArtistWhereInput[]
    NOT?: ArtistWhereInput | ArtistWhereInput[]
    name?: StringFilter<"Artist"> | string
    username?: StringNullableFilter<"Artist"> | string | null
    userId?: StringNullableFilter<"Artist"> | string | null
    bio?: StringNullableFilter<"Artist"> | string | null
    createdAt?: DateTimeFilter<"Artist"> | Date | string
    updatedAt?: DateTimeFilter<"Artist"> | Date | string
    artworks?: ArtworkListRelationFilter
  }, "id" | "unique_username_userid">

  export type ArtistOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    username?: SortOrderInput | SortOrder
    userId?: SortOrderInput | SortOrder
    bio?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: ArtistCountOrderByAggregateInput
    _avg?: ArtistAvgOrderByAggregateInput
    _max?: ArtistMaxOrderByAggregateInput
    _min?: ArtistMinOrderByAggregateInput
    _sum?: ArtistSumOrderByAggregateInput
  }

  export type ArtistScalarWhereWithAggregatesInput = {
    AND?: ArtistScalarWhereWithAggregatesInput | ArtistScalarWhereWithAggregatesInput[]
    OR?: ArtistScalarWhereWithAggregatesInput[]
    NOT?: ArtistScalarWhereWithAggregatesInput | ArtistScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"Artist"> | number
    name?: StringWithAggregatesFilter<"Artist"> | string
    username?: StringNullableWithAggregatesFilter<"Artist"> | string | null
    userId?: StringNullableWithAggregatesFilter<"Artist"> | string | null
    bio?: StringNullableWithAggregatesFilter<"Artist"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Artist"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Artist"> | Date | string
  }

  export type ArtworkWhereInput = {
    AND?: ArtworkWhereInput | ArtworkWhereInput[]
    OR?: ArtworkWhereInput[]
    NOT?: ArtworkWhereInput | ArtworkWhereInput[]
    id?: IntFilter<"Artwork"> | number
    title?: StringFilter<"Artwork"> | string
    description?: StringNullableFilter<"Artwork"> | string | null
    artistId?: IntNullableFilter<"Artwork"> | number | null
    createdAt?: DateTimeFilter<"Artwork"> | Date | string
    updatedAt?: DateTimeFilter<"Artwork"> | Date | string
    descriptionLength?: IntFilter<"Artwork"> | number
    directoryCreatedAt?: DateTimeNullableFilter<"Artwork"> | Date | string | null
    imageCount?: IntFilter<"Artwork"> | number
    bookmarkCount?: IntNullableFilter<"Artwork"> | number | null
    externalId?: StringNullableFilter<"Artwork"> | string | null
    isAiGenerated?: BoolNullableFilter<"Artwork"> | boolean | null
    originalUrl?: StringNullableFilter<"Artwork"> | string | null
    size?: StringNullableFilter<"Artwork"> | string | null
    sourceDate?: DateTimeNullableFilter<"Artwork"> | Date | string | null
    sourceUrl?: StringNullableFilter<"Artwork"> | string | null
    thumbnailUrl?: StringNullableFilter<"Artwork"> | string | null
    xRestrict?: StringNullableFilter<"Artwork"> | string | null
    artist?: XOR<ArtistNullableRelationFilter, ArtistWhereInput> | null
    artworkTags?: ArtworkTagListRelationFilter
    images?: ImageListRelationFilter
  }

  export type ArtworkOrderByWithRelationInput = {
    id?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    artistId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    descriptionLength?: SortOrder
    directoryCreatedAt?: SortOrderInput | SortOrder
    imageCount?: SortOrder
    bookmarkCount?: SortOrderInput | SortOrder
    externalId?: SortOrderInput | SortOrder
    isAiGenerated?: SortOrderInput | SortOrder
    originalUrl?: SortOrderInput | SortOrder
    size?: SortOrderInput | SortOrder
    sourceDate?: SortOrderInput | SortOrder
    sourceUrl?: SortOrderInput | SortOrder
    thumbnailUrl?: SortOrderInput | SortOrder
    xRestrict?: SortOrderInput | SortOrder
    artist?: ArtistOrderByWithRelationInput
    artworkTags?: ArtworkTagOrderByRelationAggregateInput
    images?: ImageOrderByRelationAggregateInput
    _relevance?: ArtworkOrderByRelevanceInput
  }

  export type ArtworkWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    AND?: ArtworkWhereInput | ArtworkWhereInput[]
    OR?: ArtworkWhereInput[]
    NOT?: ArtworkWhereInput | ArtworkWhereInput[]
    title?: StringFilter<"Artwork"> | string
    description?: StringNullableFilter<"Artwork"> | string | null
    artistId?: IntNullableFilter<"Artwork"> | number | null
    createdAt?: DateTimeFilter<"Artwork"> | Date | string
    updatedAt?: DateTimeFilter<"Artwork"> | Date | string
    descriptionLength?: IntFilter<"Artwork"> | number
    directoryCreatedAt?: DateTimeNullableFilter<"Artwork"> | Date | string | null
    imageCount?: IntFilter<"Artwork"> | number
    bookmarkCount?: IntNullableFilter<"Artwork"> | number | null
    externalId?: StringNullableFilter<"Artwork"> | string | null
    isAiGenerated?: BoolNullableFilter<"Artwork"> | boolean | null
    originalUrl?: StringNullableFilter<"Artwork"> | string | null
    size?: StringNullableFilter<"Artwork"> | string | null
    sourceDate?: DateTimeNullableFilter<"Artwork"> | Date | string | null
    sourceUrl?: StringNullableFilter<"Artwork"> | string | null
    thumbnailUrl?: StringNullableFilter<"Artwork"> | string | null
    xRestrict?: StringNullableFilter<"Artwork"> | string | null
    artist?: XOR<ArtistNullableRelationFilter, ArtistWhereInput> | null
    artworkTags?: ArtworkTagListRelationFilter
    images?: ImageListRelationFilter
  }, "id">

  export type ArtworkOrderByWithAggregationInput = {
    id?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    artistId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    descriptionLength?: SortOrder
    directoryCreatedAt?: SortOrderInput | SortOrder
    imageCount?: SortOrder
    bookmarkCount?: SortOrderInput | SortOrder
    externalId?: SortOrderInput | SortOrder
    isAiGenerated?: SortOrderInput | SortOrder
    originalUrl?: SortOrderInput | SortOrder
    size?: SortOrderInput | SortOrder
    sourceDate?: SortOrderInput | SortOrder
    sourceUrl?: SortOrderInput | SortOrder
    thumbnailUrl?: SortOrderInput | SortOrder
    xRestrict?: SortOrderInput | SortOrder
    _count?: ArtworkCountOrderByAggregateInput
    _avg?: ArtworkAvgOrderByAggregateInput
    _max?: ArtworkMaxOrderByAggregateInput
    _min?: ArtworkMinOrderByAggregateInput
    _sum?: ArtworkSumOrderByAggregateInput
  }

  export type ArtworkScalarWhereWithAggregatesInput = {
    AND?: ArtworkScalarWhereWithAggregatesInput | ArtworkScalarWhereWithAggregatesInput[]
    OR?: ArtworkScalarWhereWithAggregatesInput[]
    NOT?: ArtworkScalarWhereWithAggregatesInput | ArtworkScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"Artwork"> | number
    title?: StringWithAggregatesFilter<"Artwork"> | string
    description?: StringNullableWithAggregatesFilter<"Artwork"> | string | null
    artistId?: IntNullableWithAggregatesFilter<"Artwork"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"Artwork"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Artwork"> | Date | string
    descriptionLength?: IntWithAggregatesFilter<"Artwork"> | number
    directoryCreatedAt?: DateTimeNullableWithAggregatesFilter<"Artwork"> | Date | string | null
    imageCount?: IntWithAggregatesFilter<"Artwork"> | number
    bookmarkCount?: IntNullableWithAggregatesFilter<"Artwork"> | number | null
    externalId?: StringNullableWithAggregatesFilter<"Artwork"> | string | null
    isAiGenerated?: BoolNullableWithAggregatesFilter<"Artwork"> | boolean | null
    originalUrl?: StringNullableWithAggregatesFilter<"Artwork"> | string | null
    size?: StringNullableWithAggregatesFilter<"Artwork"> | string | null
    sourceDate?: DateTimeNullableWithAggregatesFilter<"Artwork"> | Date | string | null
    sourceUrl?: StringNullableWithAggregatesFilter<"Artwork"> | string | null
    thumbnailUrl?: StringNullableWithAggregatesFilter<"Artwork"> | string | null
    xRestrict?: StringNullableWithAggregatesFilter<"Artwork"> | string | null
  }

  export type TagWhereInput = {
    AND?: TagWhereInput | TagWhereInput[]
    OR?: TagWhereInput[]
    NOT?: TagWhereInput | TagWhereInput[]
    id?: IntFilter<"Tag"> | number
    name?: StringFilter<"Tag"> | string
    name_zh?: StringNullableFilter<"Tag"> | string | null
    description?: StringNullableFilter<"Tag"> | string | null
    artworkCount?: IntFilter<"Tag"> | number
    createdAt?: DateTimeFilter<"Tag"> | Date | string
    updatedAt?: DateTimeFilter<"Tag"> | Date | string
    artworkTags?: ArtworkTagListRelationFilter
  }

  export type TagOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    name_zh?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    artworkCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    artworkTags?: ArtworkTagOrderByRelationAggregateInput
    _relevance?: TagOrderByRelevanceInput
  }

  export type TagWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    name?: string
    AND?: TagWhereInput | TagWhereInput[]
    OR?: TagWhereInput[]
    NOT?: TagWhereInput | TagWhereInput[]
    name_zh?: StringNullableFilter<"Tag"> | string | null
    description?: StringNullableFilter<"Tag"> | string | null
    artworkCount?: IntFilter<"Tag"> | number
    createdAt?: DateTimeFilter<"Tag"> | Date | string
    updatedAt?: DateTimeFilter<"Tag"> | Date | string
    artworkTags?: ArtworkTagListRelationFilter
  }, "id" | "name">

  export type TagOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    name_zh?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    artworkCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TagCountOrderByAggregateInput
    _avg?: TagAvgOrderByAggregateInput
    _max?: TagMaxOrderByAggregateInput
    _min?: TagMinOrderByAggregateInput
    _sum?: TagSumOrderByAggregateInput
  }

  export type TagScalarWhereWithAggregatesInput = {
    AND?: TagScalarWhereWithAggregatesInput | TagScalarWhereWithAggregatesInput[]
    OR?: TagScalarWhereWithAggregatesInput[]
    NOT?: TagScalarWhereWithAggregatesInput | TagScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"Tag"> | number
    name?: StringWithAggregatesFilter<"Tag"> | string
    name_zh?: StringNullableWithAggregatesFilter<"Tag"> | string | null
    description?: StringNullableWithAggregatesFilter<"Tag"> | string | null
    artworkCount?: IntWithAggregatesFilter<"Tag"> | number
    createdAt?: DateTimeWithAggregatesFilter<"Tag"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Tag"> | Date | string
  }

  export type ArtworkTagWhereInput = {
    AND?: ArtworkTagWhereInput | ArtworkTagWhereInput[]
    OR?: ArtworkTagWhereInput[]
    NOT?: ArtworkTagWhereInput | ArtworkTagWhereInput[]
    id?: IntFilter<"ArtworkTag"> | number
    artworkId?: IntFilter<"ArtworkTag"> | number
    tagId?: IntFilter<"ArtworkTag"> | number
    createdAt?: DateTimeFilter<"ArtworkTag"> | Date | string
    artwork?: XOR<ArtworkRelationFilter, ArtworkWhereInput>
    tag?: XOR<TagRelationFilter, TagWhereInput>
  }

  export type ArtworkTagOrderByWithRelationInput = {
    id?: SortOrder
    artworkId?: SortOrder
    tagId?: SortOrder
    createdAt?: SortOrder
    artwork?: ArtworkOrderByWithRelationInput
    tag?: TagOrderByWithRelationInput
  }

  export type ArtworkTagWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    artworkId_tagId?: ArtworkTagArtworkIdTagIdCompoundUniqueInput
    AND?: ArtworkTagWhereInput | ArtworkTagWhereInput[]
    OR?: ArtworkTagWhereInput[]
    NOT?: ArtworkTagWhereInput | ArtworkTagWhereInput[]
    artworkId?: IntFilter<"ArtworkTag"> | number
    tagId?: IntFilter<"ArtworkTag"> | number
    createdAt?: DateTimeFilter<"ArtworkTag"> | Date | string
    artwork?: XOR<ArtworkRelationFilter, ArtworkWhereInput>
    tag?: XOR<TagRelationFilter, TagWhereInput>
  }, "id" | "artworkId_tagId">

  export type ArtworkTagOrderByWithAggregationInput = {
    id?: SortOrder
    artworkId?: SortOrder
    tagId?: SortOrder
    createdAt?: SortOrder
    _count?: ArtworkTagCountOrderByAggregateInput
    _avg?: ArtworkTagAvgOrderByAggregateInput
    _max?: ArtworkTagMaxOrderByAggregateInput
    _min?: ArtworkTagMinOrderByAggregateInput
    _sum?: ArtworkTagSumOrderByAggregateInput
  }

  export type ArtworkTagScalarWhereWithAggregatesInput = {
    AND?: ArtworkTagScalarWhereWithAggregatesInput | ArtworkTagScalarWhereWithAggregatesInput[]
    OR?: ArtworkTagScalarWhereWithAggregatesInput[]
    NOT?: ArtworkTagScalarWhereWithAggregatesInput | ArtworkTagScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"ArtworkTag"> | number
    artworkId?: IntWithAggregatesFilter<"ArtworkTag"> | number
    tagId?: IntWithAggregatesFilter<"ArtworkTag"> | number
    createdAt?: DateTimeWithAggregatesFilter<"ArtworkTag"> | Date | string
  }

  export type ImageWhereInput = {
    AND?: ImageWhereInput | ImageWhereInput[]
    OR?: ImageWhereInput[]
    NOT?: ImageWhereInput | ImageWhereInput[]
    id?: IntFilter<"Image"> | number
    path?: StringFilter<"Image"> | string
    width?: IntNullableFilter<"Image"> | number | null
    height?: IntNullableFilter<"Image"> | number | null
    size?: IntNullableFilter<"Image"> | number | null
    sortOrder?: IntFilter<"Image"> | number
    artworkId?: IntNullableFilter<"Image"> | number | null
    createdAt?: DateTimeFilter<"Image"> | Date | string
    updatedAt?: DateTimeFilter<"Image"> | Date | string
    artwork?: XOR<ArtworkNullableRelationFilter, ArtworkWhereInput> | null
  }

  export type ImageOrderByWithRelationInput = {
    id?: SortOrder
    path?: SortOrder
    width?: SortOrderInput | SortOrder
    height?: SortOrderInput | SortOrder
    size?: SortOrderInput | SortOrder
    sortOrder?: SortOrder
    artworkId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    artwork?: ArtworkOrderByWithRelationInput
    _relevance?: ImageOrderByRelevanceInput
  }

  export type ImageWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    unique_artwork_path?: ImageUnique_artwork_pathCompoundUniqueInput
    AND?: ImageWhereInput | ImageWhereInput[]
    OR?: ImageWhereInput[]
    NOT?: ImageWhereInput | ImageWhereInput[]
    path?: StringFilter<"Image"> | string
    width?: IntNullableFilter<"Image"> | number | null
    height?: IntNullableFilter<"Image"> | number | null
    size?: IntNullableFilter<"Image"> | number | null
    sortOrder?: IntFilter<"Image"> | number
    artworkId?: IntNullableFilter<"Image"> | number | null
    createdAt?: DateTimeFilter<"Image"> | Date | string
    updatedAt?: DateTimeFilter<"Image"> | Date | string
    artwork?: XOR<ArtworkNullableRelationFilter, ArtworkWhereInput> | null
  }, "id" | "unique_artwork_path">

  export type ImageOrderByWithAggregationInput = {
    id?: SortOrder
    path?: SortOrder
    width?: SortOrderInput | SortOrder
    height?: SortOrderInput | SortOrder
    size?: SortOrderInput | SortOrder
    sortOrder?: SortOrder
    artworkId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: ImageCountOrderByAggregateInput
    _avg?: ImageAvgOrderByAggregateInput
    _max?: ImageMaxOrderByAggregateInput
    _min?: ImageMinOrderByAggregateInput
    _sum?: ImageSumOrderByAggregateInput
  }

  export type ImageScalarWhereWithAggregatesInput = {
    AND?: ImageScalarWhereWithAggregatesInput | ImageScalarWhereWithAggregatesInput[]
    OR?: ImageScalarWhereWithAggregatesInput[]
    NOT?: ImageScalarWhereWithAggregatesInput | ImageScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"Image"> | number
    path?: StringWithAggregatesFilter<"Image"> | string
    width?: IntNullableWithAggregatesFilter<"Image"> | number | null
    height?: IntNullableWithAggregatesFilter<"Image"> | number | null
    size?: IntNullableWithAggregatesFilter<"Image"> | number | null
    sortOrder?: IntWithAggregatesFilter<"Image"> | number
    artworkId?: IntNullableWithAggregatesFilter<"Image"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"Image"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Image"> | Date | string
  }

  export type UserWhereInput = {
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    id?: IntFilter<"User"> | number
    username?: StringFilter<"User"> | string
    password?: StringFilter<"User"> | string
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
  }

  export type UserOrderByWithRelationInput = {
    id?: SortOrder
    username?: SortOrder
    password?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _relevance?: UserOrderByRelevanceInput
  }

  export type UserWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    username?: string
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    password?: StringFilter<"User"> | string
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
  }, "id" | "username">

  export type UserOrderByWithAggregationInput = {
    id?: SortOrder
    username?: SortOrder
    password?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: UserCountOrderByAggregateInput
    _avg?: UserAvgOrderByAggregateInput
    _max?: UserMaxOrderByAggregateInput
    _min?: UserMinOrderByAggregateInput
    _sum?: UserSumOrderByAggregateInput
  }

  export type UserScalarWhereWithAggregatesInput = {
    AND?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    OR?: UserScalarWhereWithAggregatesInput[]
    NOT?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"User"> | number
    username?: StringWithAggregatesFilter<"User"> | string
    password?: StringWithAggregatesFilter<"User"> | string
    createdAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
  }

  export type SettingWhereInput = {
    AND?: SettingWhereInput | SettingWhereInput[]
    OR?: SettingWhereInput[]
    NOT?: SettingWhereInput | SettingWhereInput[]
    id?: IntFilter<"Setting"> | number
    key?: StringFilter<"Setting"> | string
    value?: StringNullableFilter<"Setting"> | string | null
    type?: StringFilter<"Setting"> | string
    createdAt?: DateTimeFilter<"Setting"> | Date | string
    updatedAt?: DateTimeFilter<"Setting"> | Date | string
  }

  export type SettingOrderByWithRelationInput = {
    id?: SortOrder
    key?: SortOrder
    value?: SortOrderInput | SortOrder
    type?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _relevance?: SettingOrderByRelevanceInput
  }

  export type SettingWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    key?: string
    AND?: SettingWhereInput | SettingWhereInput[]
    OR?: SettingWhereInput[]
    NOT?: SettingWhereInput | SettingWhereInput[]
    value?: StringNullableFilter<"Setting"> | string | null
    type?: StringFilter<"Setting"> | string
    createdAt?: DateTimeFilter<"Setting"> | Date | string
    updatedAt?: DateTimeFilter<"Setting"> | Date | string
  }, "id" | "key">

  export type SettingOrderByWithAggregationInput = {
    id?: SortOrder
    key?: SortOrder
    value?: SortOrderInput | SortOrder
    type?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: SettingCountOrderByAggregateInput
    _avg?: SettingAvgOrderByAggregateInput
    _max?: SettingMaxOrderByAggregateInput
    _min?: SettingMinOrderByAggregateInput
    _sum?: SettingSumOrderByAggregateInput
  }

  export type SettingScalarWhereWithAggregatesInput = {
    AND?: SettingScalarWhereWithAggregatesInput | SettingScalarWhereWithAggregatesInput[]
    OR?: SettingScalarWhereWithAggregatesInput[]
    NOT?: SettingScalarWhereWithAggregatesInput | SettingScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"Setting"> | number
    key?: StringWithAggregatesFilter<"Setting"> | string
    value?: StringNullableWithAggregatesFilter<"Setting"> | string | null
    type?: StringWithAggregatesFilter<"Setting"> | string
    createdAt?: DateTimeWithAggregatesFilter<"Setting"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Setting"> | Date | string
  }

  export type TriggerLogWhereInput = {
    AND?: TriggerLogWhereInput | TriggerLogWhereInput[]
    OR?: TriggerLogWhereInput[]
    NOT?: TriggerLogWhereInput | TriggerLogWhereInput[]
    id?: IntFilter<"TriggerLog"> | number
    operation?: StringFilter<"TriggerLog"> | string
    table_name?: StringFilter<"TriggerLog"> | string
    record_id?: IntNullableFilter<"TriggerLog"> | number | null
    old_value?: IntNullableFilter<"TriggerLog"> | number | null
    new_value?: IntNullableFilter<"TriggerLog"> | number | null
    error_message?: StringNullableFilter<"TriggerLog"> | string | null
    created_at?: DateTimeFilter<"TriggerLog"> | Date | string
  }

  export type TriggerLogOrderByWithRelationInput = {
    id?: SortOrder
    operation?: SortOrder
    table_name?: SortOrder
    record_id?: SortOrderInput | SortOrder
    old_value?: SortOrderInput | SortOrder
    new_value?: SortOrderInput | SortOrder
    error_message?: SortOrderInput | SortOrder
    created_at?: SortOrder
    _relevance?: TriggerLogOrderByRelevanceInput
  }

  export type TriggerLogWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    AND?: TriggerLogWhereInput | TriggerLogWhereInput[]
    OR?: TriggerLogWhereInput[]
    NOT?: TriggerLogWhereInput | TriggerLogWhereInput[]
    operation?: StringFilter<"TriggerLog"> | string
    table_name?: StringFilter<"TriggerLog"> | string
    record_id?: IntNullableFilter<"TriggerLog"> | number | null
    old_value?: IntNullableFilter<"TriggerLog"> | number | null
    new_value?: IntNullableFilter<"TriggerLog"> | number | null
    error_message?: StringNullableFilter<"TriggerLog"> | string | null
    created_at?: DateTimeFilter<"TriggerLog"> | Date | string
  }, "id">

  export type TriggerLogOrderByWithAggregationInput = {
    id?: SortOrder
    operation?: SortOrder
    table_name?: SortOrder
    record_id?: SortOrderInput | SortOrder
    old_value?: SortOrderInput | SortOrder
    new_value?: SortOrderInput | SortOrder
    error_message?: SortOrderInput | SortOrder
    created_at?: SortOrder
    _count?: TriggerLogCountOrderByAggregateInput
    _avg?: TriggerLogAvgOrderByAggregateInput
    _max?: TriggerLogMaxOrderByAggregateInput
    _min?: TriggerLogMinOrderByAggregateInput
    _sum?: TriggerLogSumOrderByAggregateInput
  }

  export type TriggerLogScalarWhereWithAggregatesInput = {
    AND?: TriggerLogScalarWhereWithAggregatesInput | TriggerLogScalarWhereWithAggregatesInput[]
    OR?: TriggerLogScalarWhereWithAggregatesInput[]
    NOT?: TriggerLogScalarWhereWithAggregatesInput | TriggerLogScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"TriggerLog"> | number
    operation?: StringWithAggregatesFilter<"TriggerLog"> | string
    table_name?: StringWithAggregatesFilter<"TriggerLog"> | string
    record_id?: IntNullableWithAggregatesFilter<"TriggerLog"> | number | null
    old_value?: IntNullableWithAggregatesFilter<"TriggerLog"> | number | null
    new_value?: IntNullableWithAggregatesFilter<"TriggerLog"> | number | null
    error_message?: StringNullableWithAggregatesFilter<"TriggerLog"> | string | null
    created_at?: DateTimeWithAggregatesFilter<"TriggerLog"> | Date | string
  }

  export type ArtistCreateInput = {
    name: string
    username?: string | null
    userId?: string | null
    bio?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    artworks?: ArtworkCreateNestedManyWithoutArtistInput
  }

  export type ArtistUncheckedCreateInput = {
    id?: number
    name: string
    username?: string | null
    userId?: string | null
    bio?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    artworks?: ArtworkUncheckedCreateNestedManyWithoutArtistInput
  }

  export type ArtistUpdateInput = {
    name?: StringFieldUpdateOperationsInput | string
    username?: NullableStringFieldUpdateOperationsInput | string | null
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    artworks?: ArtworkUpdateManyWithoutArtistNestedInput
  }

  export type ArtistUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    username?: NullableStringFieldUpdateOperationsInput | string | null
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    artworks?: ArtworkUncheckedUpdateManyWithoutArtistNestedInput
  }

  export type ArtistCreateManyInput = {
    id?: number
    name: string
    username?: string | null
    userId?: string | null
    bio?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ArtistUpdateManyMutationInput = {
    name?: StringFieldUpdateOperationsInput | string
    username?: NullableStringFieldUpdateOperationsInput | string | null
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtistUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    username?: NullableStringFieldUpdateOperationsInput | string | null
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtworkCreateInput = {
    title: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
    artist?: ArtistCreateNestedOneWithoutArtworksInput
    artworkTags?: ArtworkTagCreateNestedManyWithoutArtworkInput
    images?: ImageCreateNestedManyWithoutArtworkInput
  }

  export type ArtworkUncheckedCreateInput = {
    id?: number
    title: string
    description?: string | null
    artistId?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
    artworkTags?: ArtworkTagUncheckedCreateNestedManyWithoutArtworkInput
    images?: ImageUncheckedCreateNestedManyWithoutArtworkInput
  }

  export type ArtworkUpdateInput = {
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
    artist?: ArtistUpdateOneWithoutArtworksNestedInput
    artworkTags?: ArtworkTagUpdateManyWithoutArtworkNestedInput
    images?: ImageUpdateManyWithoutArtworkNestedInput
  }

  export type ArtworkUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artistId?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
    artworkTags?: ArtworkTagUncheckedUpdateManyWithoutArtworkNestedInput
    images?: ImageUncheckedUpdateManyWithoutArtworkNestedInput
  }

  export type ArtworkCreateManyInput = {
    id?: number
    title: string
    description?: string | null
    artistId?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
  }

  export type ArtworkUpdateManyMutationInput = {
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ArtworkUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artistId?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type TagCreateInput = {
    name: string
    name_zh?: string | null
    description?: string | null
    artworkCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    artworkTags?: ArtworkTagCreateNestedManyWithoutTagInput
  }

  export type TagUncheckedCreateInput = {
    id?: number
    name: string
    name_zh?: string | null
    description?: string | null
    artworkCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    artworkTags?: ArtworkTagUncheckedCreateNestedManyWithoutTagInput
  }

  export type TagUpdateInput = {
    name?: StringFieldUpdateOperationsInput | string
    name_zh?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artworkCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    artworkTags?: ArtworkTagUpdateManyWithoutTagNestedInput
  }

  export type TagUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    name_zh?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artworkCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    artworkTags?: ArtworkTagUncheckedUpdateManyWithoutTagNestedInput
  }

  export type TagCreateManyInput = {
    id?: number
    name: string
    name_zh?: string | null
    description?: string | null
    artworkCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TagUpdateManyMutationInput = {
    name?: StringFieldUpdateOperationsInput | string
    name_zh?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artworkCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TagUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    name_zh?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artworkCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtworkTagCreateInput = {
    createdAt?: Date | string
    artwork: ArtworkCreateNestedOneWithoutArtworkTagsInput
    tag: TagCreateNestedOneWithoutArtworkTagsInput
  }

  export type ArtworkTagUncheckedCreateInput = {
    id?: number
    artworkId: number
    tagId: number
    createdAt?: Date | string
  }

  export type ArtworkTagUpdateInput = {
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    artwork?: ArtworkUpdateOneRequiredWithoutArtworkTagsNestedInput
    tag?: TagUpdateOneRequiredWithoutArtworkTagsNestedInput
  }

  export type ArtworkTagUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    artworkId?: IntFieldUpdateOperationsInput | number
    tagId?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtworkTagCreateManyInput = {
    id?: number
    artworkId: number
    tagId: number
    createdAt?: Date | string
  }

  export type ArtworkTagUpdateManyMutationInput = {
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtworkTagUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    artworkId?: IntFieldUpdateOperationsInput | number
    tagId?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ImageCreateInput = {
    path: string
    width?: number | null
    height?: number | null
    size?: number | null
    sortOrder?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    artwork?: ArtworkCreateNestedOneWithoutImagesInput
  }

  export type ImageUncheckedCreateInput = {
    id?: number
    path: string
    width?: number | null
    height?: number | null
    size?: number | null
    sortOrder?: number
    artworkId?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ImageUpdateInput = {
    path?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    size?: NullableIntFieldUpdateOperationsInput | number | null
    sortOrder?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    artwork?: ArtworkUpdateOneWithoutImagesNestedInput
  }

  export type ImageUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    path?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    size?: NullableIntFieldUpdateOperationsInput | number | null
    sortOrder?: IntFieldUpdateOperationsInput | number
    artworkId?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ImageCreateManyInput = {
    id?: number
    path: string
    width?: number | null
    height?: number | null
    size?: number | null
    sortOrder?: number
    artworkId?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ImageUpdateManyMutationInput = {
    path?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    size?: NullableIntFieldUpdateOperationsInput | number | null
    sortOrder?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ImageUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    path?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    size?: NullableIntFieldUpdateOperationsInput | number | null
    sortOrder?: IntFieldUpdateOperationsInput | number
    artworkId?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserCreateInput = {
    username: string
    password: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserUncheckedCreateInput = {
    id?: number
    username: string
    password: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserUpdateInput = {
    username?: StringFieldUpdateOperationsInput | string
    password?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    username?: StringFieldUpdateOperationsInput | string
    password?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserCreateManyInput = {
    id?: number
    username: string
    password: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserUpdateManyMutationInput = {
    username?: StringFieldUpdateOperationsInput | string
    password?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    username?: StringFieldUpdateOperationsInput | string
    password?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SettingCreateInput = {
    key: string
    value?: string | null
    type?: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SettingUncheckedCreateInput = {
    id?: number
    key: string
    value?: string | null
    type?: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SettingUpdateInput = {
    key?: StringFieldUpdateOperationsInput | string
    value?: NullableStringFieldUpdateOperationsInput | string | null
    type?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SettingUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    key?: StringFieldUpdateOperationsInput | string
    value?: NullableStringFieldUpdateOperationsInput | string | null
    type?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SettingCreateManyInput = {
    id?: number
    key: string
    value?: string | null
    type?: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SettingUpdateManyMutationInput = {
    key?: StringFieldUpdateOperationsInput | string
    value?: NullableStringFieldUpdateOperationsInput | string | null
    type?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SettingUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    key?: StringFieldUpdateOperationsInput | string
    value?: NullableStringFieldUpdateOperationsInput | string | null
    type?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TriggerLogCreateInput = {
    operation: string
    table_name: string
    record_id?: number | null
    old_value?: number | null
    new_value?: number | null
    error_message?: string | null
    created_at?: Date | string
  }

  export type TriggerLogUncheckedCreateInput = {
    id?: number
    operation: string
    table_name: string
    record_id?: number | null
    old_value?: number | null
    new_value?: number | null
    error_message?: string | null
    created_at?: Date | string
  }

  export type TriggerLogUpdateInput = {
    operation?: StringFieldUpdateOperationsInput | string
    table_name?: StringFieldUpdateOperationsInput | string
    record_id?: NullableIntFieldUpdateOperationsInput | number | null
    old_value?: NullableIntFieldUpdateOperationsInput | number | null
    new_value?: NullableIntFieldUpdateOperationsInput | number | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TriggerLogUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    operation?: StringFieldUpdateOperationsInput | string
    table_name?: StringFieldUpdateOperationsInput | string
    record_id?: NullableIntFieldUpdateOperationsInput | number | null
    old_value?: NullableIntFieldUpdateOperationsInput | number | null
    new_value?: NullableIntFieldUpdateOperationsInput | number | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TriggerLogCreateManyInput = {
    id?: number
    operation: string
    table_name: string
    record_id?: number | null
    old_value?: number | null
    new_value?: number | null
    error_message?: string | null
    created_at?: Date | string
  }

  export type TriggerLogUpdateManyMutationInput = {
    operation?: StringFieldUpdateOperationsInput | string
    table_name?: StringFieldUpdateOperationsInput | string
    record_id?: NullableIntFieldUpdateOperationsInput | number | null
    old_value?: NullableIntFieldUpdateOperationsInput | number | null
    new_value?: NullableIntFieldUpdateOperationsInput | number | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TriggerLogUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    operation?: StringFieldUpdateOperationsInput | string
    table_name?: StringFieldUpdateOperationsInput | string
    record_id?: NullableIntFieldUpdateOperationsInput | number | null
    old_value?: NullableIntFieldUpdateOperationsInput | number | null
    new_value?: NullableIntFieldUpdateOperationsInput | number | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    search?: string
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    search?: string
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type ArtworkListRelationFilter = {
    every?: ArtworkWhereInput
    some?: ArtworkWhereInput
    none?: ArtworkWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type ArtworkOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ArtistOrderByRelevanceInput = {
    fields: ArtistOrderByRelevanceFieldEnum | ArtistOrderByRelevanceFieldEnum[]
    sort: SortOrder
    search: string
  }

  export type ArtistUnique_username_useridCompoundUniqueInput = {
    username: string
    userId: string
  }

  export type ArtistCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    username?: SortOrder
    userId?: SortOrder
    bio?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ArtistAvgOrderByAggregateInput = {
    id?: SortOrder
  }

  export type ArtistMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    username?: SortOrder
    userId?: SortOrder
    bio?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ArtistMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    username?: SortOrder
    userId?: SortOrder
    bio?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ArtistSumOrderByAggregateInput = {
    id?: SortOrder
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    search?: string
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    search?: string
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type BoolNullableFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableFilter<$PrismaModel> | boolean | null
  }

  export type ArtistNullableRelationFilter = {
    is?: ArtistWhereInput | null
    isNot?: ArtistWhereInput | null
  }

  export type ArtworkTagListRelationFilter = {
    every?: ArtworkTagWhereInput
    some?: ArtworkTagWhereInput
    none?: ArtworkTagWhereInput
  }

  export type ImageListRelationFilter = {
    every?: ImageWhereInput
    some?: ImageWhereInput
    none?: ImageWhereInput
  }

  export type ArtworkTagOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ImageOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ArtworkOrderByRelevanceInput = {
    fields: ArtworkOrderByRelevanceFieldEnum | ArtworkOrderByRelevanceFieldEnum[]
    sort: SortOrder
    search: string
  }

  export type ArtworkCountOrderByAggregateInput = {
    id?: SortOrder
    title?: SortOrder
    description?: SortOrder
    artistId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    descriptionLength?: SortOrder
    directoryCreatedAt?: SortOrder
    imageCount?: SortOrder
    bookmarkCount?: SortOrder
    externalId?: SortOrder
    isAiGenerated?: SortOrder
    originalUrl?: SortOrder
    size?: SortOrder
    sourceDate?: SortOrder
    sourceUrl?: SortOrder
    thumbnailUrl?: SortOrder
    xRestrict?: SortOrder
  }

  export type ArtworkAvgOrderByAggregateInput = {
    id?: SortOrder
    artistId?: SortOrder
    descriptionLength?: SortOrder
    imageCount?: SortOrder
    bookmarkCount?: SortOrder
  }

  export type ArtworkMaxOrderByAggregateInput = {
    id?: SortOrder
    title?: SortOrder
    description?: SortOrder
    artistId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    descriptionLength?: SortOrder
    directoryCreatedAt?: SortOrder
    imageCount?: SortOrder
    bookmarkCount?: SortOrder
    externalId?: SortOrder
    isAiGenerated?: SortOrder
    originalUrl?: SortOrder
    size?: SortOrder
    sourceDate?: SortOrder
    sourceUrl?: SortOrder
    thumbnailUrl?: SortOrder
    xRestrict?: SortOrder
  }

  export type ArtworkMinOrderByAggregateInput = {
    id?: SortOrder
    title?: SortOrder
    description?: SortOrder
    artistId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    descriptionLength?: SortOrder
    directoryCreatedAt?: SortOrder
    imageCount?: SortOrder
    bookmarkCount?: SortOrder
    externalId?: SortOrder
    isAiGenerated?: SortOrder
    originalUrl?: SortOrder
    size?: SortOrder
    sourceDate?: SortOrder
    sourceUrl?: SortOrder
    thumbnailUrl?: SortOrder
    xRestrict?: SortOrder
  }

  export type ArtworkSumOrderByAggregateInput = {
    id?: SortOrder
    artistId?: SortOrder
    descriptionLength?: SortOrder
    imageCount?: SortOrder
    bookmarkCount?: SortOrder
  }

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type BoolNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableWithAggregatesFilter<$PrismaModel> | boolean | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedBoolNullableFilter<$PrismaModel>
    _max?: NestedBoolNullableFilter<$PrismaModel>
  }

  export type TagOrderByRelevanceInput = {
    fields: TagOrderByRelevanceFieldEnum | TagOrderByRelevanceFieldEnum[]
    sort: SortOrder
    search: string
  }

  export type TagCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    name_zh?: SortOrder
    description?: SortOrder
    artworkCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TagAvgOrderByAggregateInput = {
    id?: SortOrder
    artworkCount?: SortOrder
  }

  export type TagMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    name_zh?: SortOrder
    description?: SortOrder
    artworkCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TagMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    name_zh?: SortOrder
    description?: SortOrder
    artworkCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TagSumOrderByAggregateInput = {
    id?: SortOrder
    artworkCount?: SortOrder
  }

  export type ArtworkRelationFilter = {
    is?: ArtworkWhereInput
    isNot?: ArtworkWhereInput
  }

  export type TagRelationFilter = {
    is?: TagWhereInput
    isNot?: TagWhereInput
  }

  export type ArtworkTagArtworkIdTagIdCompoundUniqueInput = {
    artworkId: number
    tagId: number
  }

  export type ArtworkTagCountOrderByAggregateInput = {
    id?: SortOrder
    artworkId?: SortOrder
    tagId?: SortOrder
    createdAt?: SortOrder
  }

  export type ArtworkTagAvgOrderByAggregateInput = {
    id?: SortOrder
    artworkId?: SortOrder
    tagId?: SortOrder
  }

  export type ArtworkTagMaxOrderByAggregateInput = {
    id?: SortOrder
    artworkId?: SortOrder
    tagId?: SortOrder
    createdAt?: SortOrder
  }

  export type ArtworkTagMinOrderByAggregateInput = {
    id?: SortOrder
    artworkId?: SortOrder
    tagId?: SortOrder
    createdAt?: SortOrder
  }

  export type ArtworkTagSumOrderByAggregateInput = {
    id?: SortOrder
    artworkId?: SortOrder
    tagId?: SortOrder
  }

  export type ArtworkNullableRelationFilter = {
    is?: ArtworkWhereInput | null
    isNot?: ArtworkWhereInput | null
  }

  export type ImageOrderByRelevanceInput = {
    fields: ImageOrderByRelevanceFieldEnum | ImageOrderByRelevanceFieldEnum[]
    sort: SortOrder
    search: string
  }

  export type ImageUnique_artwork_pathCompoundUniqueInput = {
    artworkId: number
    path: string
  }

  export type ImageCountOrderByAggregateInput = {
    id?: SortOrder
    path?: SortOrder
    width?: SortOrder
    height?: SortOrder
    size?: SortOrder
    sortOrder?: SortOrder
    artworkId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ImageAvgOrderByAggregateInput = {
    id?: SortOrder
    width?: SortOrder
    height?: SortOrder
    size?: SortOrder
    sortOrder?: SortOrder
    artworkId?: SortOrder
  }

  export type ImageMaxOrderByAggregateInput = {
    id?: SortOrder
    path?: SortOrder
    width?: SortOrder
    height?: SortOrder
    size?: SortOrder
    sortOrder?: SortOrder
    artworkId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ImageMinOrderByAggregateInput = {
    id?: SortOrder
    path?: SortOrder
    width?: SortOrder
    height?: SortOrder
    size?: SortOrder
    sortOrder?: SortOrder
    artworkId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ImageSumOrderByAggregateInput = {
    id?: SortOrder
    width?: SortOrder
    height?: SortOrder
    size?: SortOrder
    sortOrder?: SortOrder
    artworkId?: SortOrder
  }

  export type UserOrderByRelevanceInput = {
    fields: UserOrderByRelevanceFieldEnum | UserOrderByRelevanceFieldEnum[]
    sort: SortOrder
    search: string
  }

  export type UserCountOrderByAggregateInput = {
    id?: SortOrder
    username?: SortOrder
    password?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserAvgOrderByAggregateInput = {
    id?: SortOrder
  }

  export type UserMaxOrderByAggregateInput = {
    id?: SortOrder
    username?: SortOrder
    password?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMinOrderByAggregateInput = {
    id?: SortOrder
    username?: SortOrder
    password?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserSumOrderByAggregateInput = {
    id?: SortOrder
  }

  export type SettingOrderByRelevanceInput = {
    fields: SettingOrderByRelevanceFieldEnum | SettingOrderByRelevanceFieldEnum[]
    sort: SortOrder
    search: string
  }

  export type SettingCountOrderByAggregateInput = {
    id?: SortOrder
    key?: SortOrder
    value?: SortOrder
    type?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type SettingAvgOrderByAggregateInput = {
    id?: SortOrder
  }

  export type SettingMaxOrderByAggregateInput = {
    id?: SortOrder
    key?: SortOrder
    value?: SortOrder
    type?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type SettingMinOrderByAggregateInput = {
    id?: SortOrder
    key?: SortOrder
    value?: SortOrder
    type?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type SettingSumOrderByAggregateInput = {
    id?: SortOrder
  }

  export type TriggerLogOrderByRelevanceInput = {
    fields: TriggerLogOrderByRelevanceFieldEnum | TriggerLogOrderByRelevanceFieldEnum[]
    sort: SortOrder
    search: string
  }

  export type TriggerLogCountOrderByAggregateInput = {
    id?: SortOrder
    operation?: SortOrder
    table_name?: SortOrder
    record_id?: SortOrder
    old_value?: SortOrder
    new_value?: SortOrder
    error_message?: SortOrder
    created_at?: SortOrder
  }

  export type TriggerLogAvgOrderByAggregateInput = {
    id?: SortOrder
    record_id?: SortOrder
    old_value?: SortOrder
    new_value?: SortOrder
  }

  export type TriggerLogMaxOrderByAggregateInput = {
    id?: SortOrder
    operation?: SortOrder
    table_name?: SortOrder
    record_id?: SortOrder
    old_value?: SortOrder
    new_value?: SortOrder
    error_message?: SortOrder
    created_at?: SortOrder
  }

  export type TriggerLogMinOrderByAggregateInput = {
    id?: SortOrder
    operation?: SortOrder
    table_name?: SortOrder
    record_id?: SortOrder
    old_value?: SortOrder
    new_value?: SortOrder
    error_message?: SortOrder
    created_at?: SortOrder
  }

  export type TriggerLogSumOrderByAggregateInput = {
    id?: SortOrder
    record_id?: SortOrder
    old_value?: SortOrder
    new_value?: SortOrder
  }

  export type ArtworkCreateNestedManyWithoutArtistInput = {
    create?: XOR<ArtworkCreateWithoutArtistInput, ArtworkUncheckedCreateWithoutArtistInput> | ArtworkCreateWithoutArtistInput[] | ArtworkUncheckedCreateWithoutArtistInput[]
    connectOrCreate?: ArtworkCreateOrConnectWithoutArtistInput | ArtworkCreateOrConnectWithoutArtistInput[]
    createMany?: ArtworkCreateManyArtistInputEnvelope
    connect?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
  }

  export type ArtworkUncheckedCreateNestedManyWithoutArtistInput = {
    create?: XOR<ArtworkCreateWithoutArtistInput, ArtworkUncheckedCreateWithoutArtistInput> | ArtworkCreateWithoutArtistInput[] | ArtworkUncheckedCreateWithoutArtistInput[]
    connectOrCreate?: ArtworkCreateOrConnectWithoutArtistInput | ArtworkCreateOrConnectWithoutArtistInput[]
    createMany?: ArtworkCreateManyArtistInputEnvelope
    connect?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type ArtworkUpdateManyWithoutArtistNestedInput = {
    create?: XOR<ArtworkCreateWithoutArtistInput, ArtworkUncheckedCreateWithoutArtistInput> | ArtworkCreateWithoutArtistInput[] | ArtworkUncheckedCreateWithoutArtistInput[]
    connectOrCreate?: ArtworkCreateOrConnectWithoutArtistInput | ArtworkCreateOrConnectWithoutArtistInput[]
    upsert?: ArtworkUpsertWithWhereUniqueWithoutArtistInput | ArtworkUpsertWithWhereUniqueWithoutArtistInput[]
    createMany?: ArtworkCreateManyArtistInputEnvelope
    set?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
    disconnect?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
    delete?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
    connect?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
    update?: ArtworkUpdateWithWhereUniqueWithoutArtistInput | ArtworkUpdateWithWhereUniqueWithoutArtistInput[]
    updateMany?: ArtworkUpdateManyWithWhereWithoutArtistInput | ArtworkUpdateManyWithWhereWithoutArtistInput[]
    deleteMany?: ArtworkScalarWhereInput | ArtworkScalarWhereInput[]
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type ArtworkUncheckedUpdateManyWithoutArtistNestedInput = {
    create?: XOR<ArtworkCreateWithoutArtistInput, ArtworkUncheckedCreateWithoutArtistInput> | ArtworkCreateWithoutArtistInput[] | ArtworkUncheckedCreateWithoutArtistInput[]
    connectOrCreate?: ArtworkCreateOrConnectWithoutArtistInput | ArtworkCreateOrConnectWithoutArtistInput[]
    upsert?: ArtworkUpsertWithWhereUniqueWithoutArtistInput | ArtworkUpsertWithWhereUniqueWithoutArtistInput[]
    createMany?: ArtworkCreateManyArtistInputEnvelope
    set?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
    disconnect?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
    delete?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
    connect?: ArtworkWhereUniqueInput | ArtworkWhereUniqueInput[]
    update?: ArtworkUpdateWithWhereUniqueWithoutArtistInput | ArtworkUpdateWithWhereUniqueWithoutArtistInput[]
    updateMany?: ArtworkUpdateManyWithWhereWithoutArtistInput | ArtworkUpdateManyWithWhereWithoutArtistInput[]
    deleteMany?: ArtworkScalarWhereInput | ArtworkScalarWhereInput[]
  }

  export type ArtistCreateNestedOneWithoutArtworksInput = {
    create?: XOR<ArtistCreateWithoutArtworksInput, ArtistUncheckedCreateWithoutArtworksInput>
    connectOrCreate?: ArtistCreateOrConnectWithoutArtworksInput
    connect?: ArtistWhereUniqueInput
  }

  export type ArtworkTagCreateNestedManyWithoutArtworkInput = {
    create?: XOR<ArtworkTagCreateWithoutArtworkInput, ArtworkTagUncheckedCreateWithoutArtworkInput> | ArtworkTagCreateWithoutArtworkInput[] | ArtworkTagUncheckedCreateWithoutArtworkInput[]
    connectOrCreate?: ArtworkTagCreateOrConnectWithoutArtworkInput | ArtworkTagCreateOrConnectWithoutArtworkInput[]
    createMany?: ArtworkTagCreateManyArtworkInputEnvelope
    connect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
  }

  export type ImageCreateNestedManyWithoutArtworkInput = {
    create?: XOR<ImageCreateWithoutArtworkInput, ImageUncheckedCreateWithoutArtworkInput> | ImageCreateWithoutArtworkInput[] | ImageUncheckedCreateWithoutArtworkInput[]
    connectOrCreate?: ImageCreateOrConnectWithoutArtworkInput | ImageCreateOrConnectWithoutArtworkInput[]
    createMany?: ImageCreateManyArtworkInputEnvelope
    connect?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
  }

  export type ArtworkTagUncheckedCreateNestedManyWithoutArtworkInput = {
    create?: XOR<ArtworkTagCreateWithoutArtworkInput, ArtworkTagUncheckedCreateWithoutArtworkInput> | ArtworkTagCreateWithoutArtworkInput[] | ArtworkTagUncheckedCreateWithoutArtworkInput[]
    connectOrCreate?: ArtworkTagCreateOrConnectWithoutArtworkInput | ArtworkTagCreateOrConnectWithoutArtworkInput[]
    createMany?: ArtworkTagCreateManyArtworkInputEnvelope
    connect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
  }

  export type ImageUncheckedCreateNestedManyWithoutArtworkInput = {
    create?: XOR<ImageCreateWithoutArtworkInput, ImageUncheckedCreateWithoutArtworkInput> | ImageCreateWithoutArtworkInput[] | ImageUncheckedCreateWithoutArtworkInput[]
    connectOrCreate?: ImageCreateOrConnectWithoutArtworkInput | ImageCreateOrConnectWithoutArtworkInput[]
    createMany?: ImageCreateManyArtworkInputEnvelope
    connect?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableBoolFieldUpdateOperationsInput = {
    set?: boolean | null
  }

  export type ArtistUpdateOneWithoutArtworksNestedInput = {
    create?: XOR<ArtistCreateWithoutArtworksInput, ArtistUncheckedCreateWithoutArtworksInput>
    connectOrCreate?: ArtistCreateOrConnectWithoutArtworksInput
    upsert?: ArtistUpsertWithoutArtworksInput
    disconnect?: ArtistWhereInput | boolean
    delete?: ArtistWhereInput | boolean
    connect?: ArtistWhereUniqueInput
    update?: XOR<XOR<ArtistUpdateToOneWithWhereWithoutArtworksInput, ArtistUpdateWithoutArtworksInput>, ArtistUncheckedUpdateWithoutArtworksInput>
  }

  export type ArtworkTagUpdateManyWithoutArtworkNestedInput = {
    create?: XOR<ArtworkTagCreateWithoutArtworkInput, ArtworkTagUncheckedCreateWithoutArtworkInput> | ArtworkTagCreateWithoutArtworkInput[] | ArtworkTagUncheckedCreateWithoutArtworkInput[]
    connectOrCreate?: ArtworkTagCreateOrConnectWithoutArtworkInput | ArtworkTagCreateOrConnectWithoutArtworkInput[]
    upsert?: ArtworkTagUpsertWithWhereUniqueWithoutArtworkInput | ArtworkTagUpsertWithWhereUniqueWithoutArtworkInput[]
    createMany?: ArtworkTagCreateManyArtworkInputEnvelope
    set?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    disconnect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    delete?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    connect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    update?: ArtworkTagUpdateWithWhereUniqueWithoutArtworkInput | ArtworkTagUpdateWithWhereUniqueWithoutArtworkInput[]
    updateMany?: ArtworkTagUpdateManyWithWhereWithoutArtworkInput | ArtworkTagUpdateManyWithWhereWithoutArtworkInput[]
    deleteMany?: ArtworkTagScalarWhereInput | ArtworkTagScalarWhereInput[]
  }

  export type ImageUpdateManyWithoutArtworkNestedInput = {
    create?: XOR<ImageCreateWithoutArtworkInput, ImageUncheckedCreateWithoutArtworkInput> | ImageCreateWithoutArtworkInput[] | ImageUncheckedCreateWithoutArtworkInput[]
    connectOrCreate?: ImageCreateOrConnectWithoutArtworkInput | ImageCreateOrConnectWithoutArtworkInput[]
    upsert?: ImageUpsertWithWhereUniqueWithoutArtworkInput | ImageUpsertWithWhereUniqueWithoutArtworkInput[]
    createMany?: ImageCreateManyArtworkInputEnvelope
    set?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
    disconnect?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
    delete?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
    connect?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
    update?: ImageUpdateWithWhereUniqueWithoutArtworkInput | ImageUpdateWithWhereUniqueWithoutArtworkInput[]
    updateMany?: ImageUpdateManyWithWhereWithoutArtworkInput | ImageUpdateManyWithWhereWithoutArtworkInput[]
    deleteMany?: ImageScalarWhereInput | ImageScalarWhereInput[]
  }

  export type ArtworkTagUncheckedUpdateManyWithoutArtworkNestedInput = {
    create?: XOR<ArtworkTagCreateWithoutArtworkInput, ArtworkTagUncheckedCreateWithoutArtworkInput> | ArtworkTagCreateWithoutArtworkInput[] | ArtworkTagUncheckedCreateWithoutArtworkInput[]
    connectOrCreate?: ArtworkTagCreateOrConnectWithoutArtworkInput | ArtworkTagCreateOrConnectWithoutArtworkInput[]
    upsert?: ArtworkTagUpsertWithWhereUniqueWithoutArtworkInput | ArtworkTagUpsertWithWhereUniqueWithoutArtworkInput[]
    createMany?: ArtworkTagCreateManyArtworkInputEnvelope
    set?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    disconnect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    delete?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    connect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    update?: ArtworkTagUpdateWithWhereUniqueWithoutArtworkInput | ArtworkTagUpdateWithWhereUniqueWithoutArtworkInput[]
    updateMany?: ArtworkTagUpdateManyWithWhereWithoutArtworkInput | ArtworkTagUpdateManyWithWhereWithoutArtworkInput[]
    deleteMany?: ArtworkTagScalarWhereInput | ArtworkTagScalarWhereInput[]
  }

  export type ImageUncheckedUpdateManyWithoutArtworkNestedInput = {
    create?: XOR<ImageCreateWithoutArtworkInput, ImageUncheckedCreateWithoutArtworkInput> | ImageCreateWithoutArtworkInput[] | ImageUncheckedCreateWithoutArtworkInput[]
    connectOrCreate?: ImageCreateOrConnectWithoutArtworkInput | ImageCreateOrConnectWithoutArtworkInput[]
    upsert?: ImageUpsertWithWhereUniqueWithoutArtworkInput | ImageUpsertWithWhereUniqueWithoutArtworkInput[]
    createMany?: ImageCreateManyArtworkInputEnvelope
    set?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
    disconnect?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
    delete?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
    connect?: ImageWhereUniqueInput | ImageWhereUniqueInput[]
    update?: ImageUpdateWithWhereUniqueWithoutArtworkInput | ImageUpdateWithWhereUniqueWithoutArtworkInput[]
    updateMany?: ImageUpdateManyWithWhereWithoutArtworkInput | ImageUpdateManyWithWhereWithoutArtworkInput[]
    deleteMany?: ImageScalarWhereInput | ImageScalarWhereInput[]
  }

  export type ArtworkTagCreateNestedManyWithoutTagInput = {
    create?: XOR<ArtworkTagCreateWithoutTagInput, ArtworkTagUncheckedCreateWithoutTagInput> | ArtworkTagCreateWithoutTagInput[] | ArtworkTagUncheckedCreateWithoutTagInput[]
    connectOrCreate?: ArtworkTagCreateOrConnectWithoutTagInput | ArtworkTagCreateOrConnectWithoutTagInput[]
    createMany?: ArtworkTagCreateManyTagInputEnvelope
    connect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
  }

  export type ArtworkTagUncheckedCreateNestedManyWithoutTagInput = {
    create?: XOR<ArtworkTagCreateWithoutTagInput, ArtworkTagUncheckedCreateWithoutTagInput> | ArtworkTagCreateWithoutTagInput[] | ArtworkTagUncheckedCreateWithoutTagInput[]
    connectOrCreate?: ArtworkTagCreateOrConnectWithoutTagInput | ArtworkTagCreateOrConnectWithoutTagInput[]
    createMany?: ArtworkTagCreateManyTagInputEnvelope
    connect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
  }

  export type ArtworkTagUpdateManyWithoutTagNestedInput = {
    create?: XOR<ArtworkTagCreateWithoutTagInput, ArtworkTagUncheckedCreateWithoutTagInput> | ArtworkTagCreateWithoutTagInput[] | ArtworkTagUncheckedCreateWithoutTagInput[]
    connectOrCreate?: ArtworkTagCreateOrConnectWithoutTagInput | ArtworkTagCreateOrConnectWithoutTagInput[]
    upsert?: ArtworkTagUpsertWithWhereUniqueWithoutTagInput | ArtworkTagUpsertWithWhereUniqueWithoutTagInput[]
    createMany?: ArtworkTagCreateManyTagInputEnvelope
    set?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    disconnect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    delete?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    connect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    update?: ArtworkTagUpdateWithWhereUniqueWithoutTagInput | ArtworkTagUpdateWithWhereUniqueWithoutTagInput[]
    updateMany?: ArtworkTagUpdateManyWithWhereWithoutTagInput | ArtworkTagUpdateManyWithWhereWithoutTagInput[]
    deleteMany?: ArtworkTagScalarWhereInput | ArtworkTagScalarWhereInput[]
  }

  export type ArtworkTagUncheckedUpdateManyWithoutTagNestedInput = {
    create?: XOR<ArtworkTagCreateWithoutTagInput, ArtworkTagUncheckedCreateWithoutTagInput> | ArtworkTagCreateWithoutTagInput[] | ArtworkTagUncheckedCreateWithoutTagInput[]
    connectOrCreate?: ArtworkTagCreateOrConnectWithoutTagInput | ArtworkTagCreateOrConnectWithoutTagInput[]
    upsert?: ArtworkTagUpsertWithWhereUniqueWithoutTagInput | ArtworkTagUpsertWithWhereUniqueWithoutTagInput[]
    createMany?: ArtworkTagCreateManyTagInputEnvelope
    set?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    disconnect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    delete?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    connect?: ArtworkTagWhereUniqueInput | ArtworkTagWhereUniqueInput[]
    update?: ArtworkTagUpdateWithWhereUniqueWithoutTagInput | ArtworkTagUpdateWithWhereUniqueWithoutTagInput[]
    updateMany?: ArtworkTagUpdateManyWithWhereWithoutTagInput | ArtworkTagUpdateManyWithWhereWithoutTagInput[]
    deleteMany?: ArtworkTagScalarWhereInput | ArtworkTagScalarWhereInput[]
  }

  export type ArtworkCreateNestedOneWithoutArtworkTagsInput = {
    create?: XOR<ArtworkCreateWithoutArtworkTagsInput, ArtworkUncheckedCreateWithoutArtworkTagsInput>
    connectOrCreate?: ArtworkCreateOrConnectWithoutArtworkTagsInput
    connect?: ArtworkWhereUniqueInput
  }

  export type TagCreateNestedOneWithoutArtworkTagsInput = {
    create?: XOR<TagCreateWithoutArtworkTagsInput, TagUncheckedCreateWithoutArtworkTagsInput>
    connectOrCreate?: TagCreateOrConnectWithoutArtworkTagsInput
    connect?: TagWhereUniqueInput
  }

  export type ArtworkUpdateOneRequiredWithoutArtworkTagsNestedInput = {
    create?: XOR<ArtworkCreateWithoutArtworkTagsInput, ArtworkUncheckedCreateWithoutArtworkTagsInput>
    connectOrCreate?: ArtworkCreateOrConnectWithoutArtworkTagsInput
    upsert?: ArtworkUpsertWithoutArtworkTagsInput
    connect?: ArtworkWhereUniqueInput
    update?: XOR<XOR<ArtworkUpdateToOneWithWhereWithoutArtworkTagsInput, ArtworkUpdateWithoutArtworkTagsInput>, ArtworkUncheckedUpdateWithoutArtworkTagsInput>
  }

  export type TagUpdateOneRequiredWithoutArtworkTagsNestedInput = {
    create?: XOR<TagCreateWithoutArtworkTagsInput, TagUncheckedCreateWithoutArtworkTagsInput>
    connectOrCreate?: TagCreateOrConnectWithoutArtworkTagsInput
    upsert?: TagUpsertWithoutArtworkTagsInput
    connect?: TagWhereUniqueInput
    update?: XOR<XOR<TagUpdateToOneWithWhereWithoutArtworkTagsInput, TagUpdateWithoutArtworkTagsInput>, TagUncheckedUpdateWithoutArtworkTagsInput>
  }

  export type ArtworkCreateNestedOneWithoutImagesInput = {
    create?: XOR<ArtworkCreateWithoutImagesInput, ArtworkUncheckedCreateWithoutImagesInput>
    connectOrCreate?: ArtworkCreateOrConnectWithoutImagesInput
    connect?: ArtworkWhereUniqueInput
  }

  export type ArtworkUpdateOneWithoutImagesNestedInput = {
    create?: XOR<ArtworkCreateWithoutImagesInput, ArtworkUncheckedCreateWithoutImagesInput>
    connectOrCreate?: ArtworkCreateOrConnectWithoutImagesInput
    upsert?: ArtworkUpsertWithoutImagesInput
    disconnect?: ArtworkWhereInput | boolean
    delete?: ArtworkWhereInput | boolean
    connect?: ArtworkWhereUniqueInput
    update?: XOR<XOR<ArtworkUpdateToOneWithWhereWithoutImagesInput, ArtworkUpdateWithoutImagesInput>, ArtworkUncheckedUpdateWithoutImagesInput>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    search?: string
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    search?: string
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    search?: string
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    search?: string
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedBoolNullableFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableFilter<$PrismaModel> | boolean | null
  }

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedBoolNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableWithAggregatesFilter<$PrismaModel> | boolean | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedBoolNullableFilter<$PrismaModel>
    _max?: NestedBoolNullableFilter<$PrismaModel>
  }

  export type ArtworkCreateWithoutArtistInput = {
    title: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
    artworkTags?: ArtworkTagCreateNestedManyWithoutArtworkInput
    images?: ImageCreateNestedManyWithoutArtworkInput
  }

  export type ArtworkUncheckedCreateWithoutArtistInput = {
    id?: number
    title: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
    artworkTags?: ArtworkTagUncheckedCreateNestedManyWithoutArtworkInput
    images?: ImageUncheckedCreateNestedManyWithoutArtworkInput
  }

  export type ArtworkCreateOrConnectWithoutArtistInput = {
    where: ArtworkWhereUniqueInput
    create: XOR<ArtworkCreateWithoutArtistInput, ArtworkUncheckedCreateWithoutArtistInput>
  }

  export type ArtworkCreateManyArtistInputEnvelope = {
    data: ArtworkCreateManyArtistInput | ArtworkCreateManyArtistInput[]
    skipDuplicates?: boolean
  }

  export type ArtworkUpsertWithWhereUniqueWithoutArtistInput = {
    where: ArtworkWhereUniqueInput
    update: XOR<ArtworkUpdateWithoutArtistInput, ArtworkUncheckedUpdateWithoutArtistInput>
    create: XOR<ArtworkCreateWithoutArtistInput, ArtworkUncheckedCreateWithoutArtistInput>
  }

  export type ArtworkUpdateWithWhereUniqueWithoutArtistInput = {
    where: ArtworkWhereUniqueInput
    data: XOR<ArtworkUpdateWithoutArtistInput, ArtworkUncheckedUpdateWithoutArtistInput>
  }

  export type ArtworkUpdateManyWithWhereWithoutArtistInput = {
    where: ArtworkScalarWhereInput
    data: XOR<ArtworkUpdateManyMutationInput, ArtworkUncheckedUpdateManyWithoutArtistInput>
  }

  export type ArtworkScalarWhereInput = {
    AND?: ArtworkScalarWhereInput | ArtworkScalarWhereInput[]
    OR?: ArtworkScalarWhereInput[]
    NOT?: ArtworkScalarWhereInput | ArtworkScalarWhereInput[]
    id?: IntFilter<"Artwork"> | number
    title?: StringFilter<"Artwork"> | string
    description?: StringNullableFilter<"Artwork"> | string | null
    artistId?: IntNullableFilter<"Artwork"> | number | null
    createdAt?: DateTimeFilter<"Artwork"> | Date | string
    updatedAt?: DateTimeFilter<"Artwork"> | Date | string
    descriptionLength?: IntFilter<"Artwork"> | number
    directoryCreatedAt?: DateTimeNullableFilter<"Artwork"> | Date | string | null
    imageCount?: IntFilter<"Artwork"> | number
    bookmarkCount?: IntNullableFilter<"Artwork"> | number | null
    externalId?: StringNullableFilter<"Artwork"> | string | null
    isAiGenerated?: BoolNullableFilter<"Artwork"> | boolean | null
    originalUrl?: StringNullableFilter<"Artwork"> | string | null
    size?: StringNullableFilter<"Artwork"> | string | null
    sourceDate?: DateTimeNullableFilter<"Artwork"> | Date | string | null
    sourceUrl?: StringNullableFilter<"Artwork"> | string | null
    thumbnailUrl?: StringNullableFilter<"Artwork"> | string | null
    xRestrict?: StringNullableFilter<"Artwork"> | string | null
  }

  export type ArtistCreateWithoutArtworksInput = {
    name: string
    username?: string | null
    userId?: string | null
    bio?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ArtistUncheckedCreateWithoutArtworksInput = {
    id?: number
    name: string
    username?: string | null
    userId?: string | null
    bio?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ArtistCreateOrConnectWithoutArtworksInput = {
    where: ArtistWhereUniqueInput
    create: XOR<ArtistCreateWithoutArtworksInput, ArtistUncheckedCreateWithoutArtworksInput>
  }

  export type ArtworkTagCreateWithoutArtworkInput = {
    createdAt?: Date | string
    tag: TagCreateNestedOneWithoutArtworkTagsInput
  }

  export type ArtworkTagUncheckedCreateWithoutArtworkInput = {
    id?: number
    tagId: number
    createdAt?: Date | string
  }

  export type ArtworkTagCreateOrConnectWithoutArtworkInput = {
    where: ArtworkTagWhereUniqueInput
    create: XOR<ArtworkTagCreateWithoutArtworkInput, ArtworkTagUncheckedCreateWithoutArtworkInput>
  }

  export type ArtworkTagCreateManyArtworkInputEnvelope = {
    data: ArtworkTagCreateManyArtworkInput | ArtworkTagCreateManyArtworkInput[]
    skipDuplicates?: boolean
  }

  export type ImageCreateWithoutArtworkInput = {
    path: string
    width?: number | null
    height?: number | null
    size?: number | null
    sortOrder?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ImageUncheckedCreateWithoutArtworkInput = {
    id?: number
    path: string
    width?: number | null
    height?: number | null
    size?: number | null
    sortOrder?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ImageCreateOrConnectWithoutArtworkInput = {
    where: ImageWhereUniqueInput
    create: XOR<ImageCreateWithoutArtworkInput, ImageUncheckedCreateWithoutArtworkInput>
  }

  export type ImageCreateManyArtworkInputEnvelope = {
    data: ImageCreateManyArtworkInput | ImageCreateManyArtworkInput[]
    skipDuplicates?: boolean
  }

  export type ArtistUpsertWithoutArtworksInput = {
    update: XOR<ArtistUpdateWithoutArtworksInput, ArtistUncheckedUpdateWithoutArtworksInput>
    create: XOR<ArtistCreateWithoutArtworksInput, ArtistUncheckedCreateWithoutArtworksInput>
    where?: ArtistWhereInput
  }

  export type ArtistUpdateToOneWithWhereWithoutArtworksInput = {
    where?: ArtistWhereInput
    data: XOR<ArtistUpdateWithoutArtworksInput, ArtistUncheckedUpdateWithoutArtworksInput>
  }

  export type ArtistUpdateWithoutArtworksInput = {
    name?: StringFieldUpdateOperationsInput | string
    username?: NullableStringFieldUpdateOperationsInput | string | null
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtistUncheckedUpdateWithoutArtworksInput = {
    id?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    username?: NullableStringFieldUpdateOperationsInput | string | null
    userId?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtworkTagUpsertWithWhereUniqueWithoutArtworkInput = {
    where: ArtworkTagWhereUniqueInput
    update: XOR<ArtworkTagUpdateWithoutArtworkInput, ArtworkTagUncheckedUpdateWithoutArtworkInput>
    create: XOR<ArtworkTagCreateWithoutArtworkInput, ArtworkTagUncheckedCreateWithoutArtworkInput>
  }

  export type ArtworkTagUpdateWithWhereUniqueWithoutArtworkInput = {
    where: ArtworkTagWhereUniqueInput
    data: XOR<ArtworkTagUpdateWithoutArtworkInput, ArtworkTagUncheckedUpdateWithoutArtworkInput>
  }

  export type ArtworkTagUpdateManyWithWhereWithoutArtworkInput = {
    where: ArtworkTagScalarWhereInput
    data: XOR<ArtworkTagUpdateManyMutationInput, ArtworkTagUncheckedUpdateManyWithoutArtworkInput>
  }

  export type ArtworkTagScalarWhereInput = {
    AND?: ArtworkTagScalarWhereInput | ArtworkTagScalarWhereInput[]
    OR?: ArtworkTagScalarWhereInput[]
    NOT?: ArtworkTagScalarWhereInput | ArtworkTagScalarWhereInput[]
    id?: IntFilter<"ArtworkTag"> | number
    artworkId?: IntFilter<"ArtworkTag"> | number
    tagId?: IntFilter<"ArtworkTag"> | number
    createdAt?: DateTimeFilter<"ArtworkTag"> | Date | string
  }

  export type ImageUpsertWithWhereUniqueWithoutArtworkInput = {
    where: ImageWhereUniqueInput
    update: XOR<ImageUpdateWithoutArtworkInput, ImageUncheckedUpdateWithoutArtworkInput>
    create: XOR<ImageCreateWithoutArtworkInput, ImageUncheckedCreateWithoutArtworkInput>
  }

  export type ImageUpdateWithWhereUniqueWithoutArtworkInput = {
    where: ImageWhereUniqueInput
    data: XOR<ImageUpdateWithoutArtworkInput, ImageUncheckedUpdateWithoutArtworkInput>
  }

  export type ImageUpdateManyWithWhereWithoutArtworkInput = {
    where: ImageScalarWhereInput
    data: XOR<ImageUpdateManyMutationInput, ImageUncheckedUpdateManyWithoutArtworkInput>
  }

  export type ImageScalarWhereInput = {
    AND?: ImageScalarWhereInput | ImageScalarWhereInput[]
    OR?: ImageScalarWhereInput[]
    NOT?: ImageScalarWhereInput | ImageScalarWhereInput[]
    id?: IntFilter<"Image"> | number
    path?: StringFilter<"Image"> | string
    width?: IntNullableFilter<"Image"> | number | null
    height?: IntNullableFilter<"Image"> | number | null
    size?: IntNullableFilter<"Image"> | number | null
    sortOrder?: IntFilter<"Image"> | number
    artworkId?: IntNullableFilter<"Image"> | number | null
    createdAt?: DateTimeFilter<"Image"> | Date | string
    updatedAt?: DateTimeFilter<"Image"> | Date | string
  }

  export type ArtworkTagCreateWithoutTagInput = {
    createdAt?: Date | string
    artwork: ArtworkCreateNestedOneWithoutArtworkTagsInput
  }

  export type ArtworkTagUncheckedCreateWithoutTagInput = {
    id?: number
    artworkId: number
    createdAt?: Date | string
  }

  export type ArtworkTagCreateOrConnectWithoutTagInput = {
    where: ArtworkTagWhereUniqueInput
    create: XOR<ArtworkTagCreateWithoutTagInput, ArtworkTagUncheckedCreateWithoutTagInput>
  }

  export type ArtworkTagCreateManyTagInputEnvelope = {
    data: ArtworkTagCreateManyTagInput | ArtworkTagCreateManyTagInput[]
    skipDuplicates?: boolean
  }

  export type ArtworkTagUpsertWithWhereUniqueWithoutTagInput = {
    where: ArtworkTagWhereUniqueInput
    update: XOR<ArtworkTagUpdateWithoutTagInput, ArtworkTagUncheckedUpdateWithoutTagInput>
    create: XOR<ArtworkTagCreateWithoutTagInput, ArtworkTagUncheckedCreateWithoutTagInput>
  }

  export type ArtworkTagUpdateWithWhereUniqueWithoutTagInput = {
    where: ArtworkTagWhereUniqueInput
    data: XOR<ArtworkTagUpdateWithoutTagInput, ArtworkTagUncheckedUpdateWithoutTagInput>
  }

  export type ArtworkTagUpdateManyWithWhereWithoutTagInput = {
    where: ArtworkTagScalarWhereInput
    data: XOR<ArtworkTagUpdateManyMutationInput, ArtworkTagUncheckedUpdateManyWithoutTagInput>
  }

  export type ArtworkCreateWithoutArtworkTagsInput = {
    title: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
    artist?: ArtistCreateNestedOneWithoutArtworksInput
    images?: ImageCreateNestedManyWithoutArtworkInput
  }

  export type ArtworkUncheckedCreateWithoutArtworkTagsInput = {
    id?: number
    title: string
    description?: string | null
    artistId?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
    images?: ImageUncheckedCreateNestedManyWithoutArtworkInput
  }

  export type ArtworkCreateOrConnectWithoutArtworkTagsInput = {
    where: ArtworkWhereUniqueInput
    create: XOR<ArtworkCreateWithoutArtworkTagsInput, ArtworkUncheckedCreateWithoutArtworkTagsInput>
  }

  export type TagCreateWithoutArtworkTagsInput = {
    name: string
    name_zh?: string | null
    description?: string | null
    artworkCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TagUncheckedCreateWithoutArtworkTagsInput = {
    id?: number
    name: string
    name_zh?: string | null
    description?: string | null
    artworkCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TagCreateOrConnectWithoutArtworkTagsInput = {
    where: TagWhereUniqueInput
    create: XOR<TagCreateWithoutArtworkTagsInput, TagUncheckedCreateWithoutArtworkTagsInput>
  }

  export type ArtworkUpsertWithoutArtworkTagsInput = {
    update: XOR<ArtworkUpdateWithoutArtworkTagsInput, ArtworkUncheckedUpdateWithoutArtworkTagsInput>
    create: XOR<ArtworkCreateWithoutArtworkTagsInput, ArtworkUncheckedCreateWithoutArtworkTagsInput>
    where?: ArtworkWhereInput
  }

  export type ArtworkUpdateToOneWithWhereWithoutArtworkTagsInput = {
    where?: ArtworkWhereInput
    data: XOR<ArtworkUpdateWithoutArtworkTagsInput, ArtworkUncheckedUpdateWithoutArtworkTagsInput>
  }

  export type ArtworkUpdateWithoutArtworkTagsInput = {
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
    artist?: ArtistUpdateOneWithoutArtworksNestedInput
    images?: ImageUpdateManyWithoutArtworkNestedInput
  }

  export type ArtworkUncheckedUpdateWithoutArtworkTagsInput = {
    id?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artistId?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
    images?: ImageUncheckedUpdateManyWithoutArtworkNestedInput
  }

  export type TagUpsertWithoutArtworkTagsInput = {
    update: XOR<TagUpdateWithoutArtworkTagsInput, TagUncheckedUpdateWithoutArtworkTagsInput>
    create: XOR<TagCreateWithoutArtworkTagsInput, TagUncheckedCreateWithoutArtworkTagsInput>
    where?: TagWhereInput
  }

  export type TagUpdateToOneWithWhereWithoutArtworkTagsInput = {
    where?: TagWhereInput
    data: XOR<TagUpdateWithoutArtworkTagsInput, TagUncheckedUpdateWithoutArtworkTagsInput>
  }

  export type TagUpdateWithoutArtworkTagsInput = {
    name?: StringFieldUpdateOperationsInput | string
    name_zh?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artworkCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TagUncheckedUpdateWithoutArtworkTagsInput = {
    id?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    name_zh?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artworkCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtworkCreateWithoutImagesInput = {
    title: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
    artist?: ArtistCreateNestedOneWithoutArtworksInput
    artworkTags?: ArtworkTagCreateNestedManyWithoutArtworkInput
  }

  export type ArtworkUncheckedCreateWithoutImagesInput = {
    id?: number
    title: string
    description?: string | null
    artistId?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
    artworkTags?: ArtworkTagUncheckedCreateNestedManyWithoutArtworkInput
  }

  export type ArtworkCreateOrConnectWithoutImagesInput = {
    where: ArtworkWhereUniqueInput
    create: XOR<ArtworkCreateWithoutImagesInput, ArtworkUncheckedCreateWithoutImagesInput>
  }

  export type ArtworkUpsertWithoutImagesInput = {
    update: XOR<ArtworkUpdateWithoutImagesInput, ArtworkUncheckedUpdateWithoutImagesInput>
    create: XOR<ArtworkCreateWithoutImagesInput, ArtworkUncheckedCreateWithoutImagesInput>
    where?: ArtworkWhereInput
  }

  export type ArtworkUpdateToOneWithWhereWithoutImagesInput = {
    where?: ArtworkWhereInput
    data: XOR<ArtworkUpdateWithoutImagesInput, ArtworkUncheckedUpdateWithoutImagesInput>
  }

  export type ArtworkUpdateWithoutImagesInput = {
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
    artist?: ArtistUpdateOneWithoutArtworksNestedInput
    artworkTags?: ArtworkTagUpdateManyWithoutArtworkNestedInput
  }

  export type ArtworkUncheckedUpdateWithoutImagesInput = {
    id?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    artistId?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
    artworkTags?: ArtworkTagUncheckedUpdateManyWithoutArtworkNestedInput
  }

  export type ArtworkCreateManyArtistInput = {
    id?: number
    title: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    descriptionLength?: number
    directoryCreatedAt?: Date | string | null
    imageCount?: number
    bookmarkCount?: number | null
    externalId?: string | null
    isAiGenerated?: boolean | null
    originalUrl?: string | null
    size?: string | null
    sourceDate?: Date | string | null
    sourceUrl?: string | null
    thumbnailUrl?: string | null
    xRestrict?: string | null
  }

  export type ArtworkUpdateWithoutArtistInput = {
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
    artworkTags?: ArtworkTagUpdateManyWithoutArtworkNestedInput
    images?: ImageUpdateManyWithoutArtworkNestedInput
  }

  export type ArtworkUncheckedUpdateWithoutArtistInput = {
    id?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
    artworkTags?: ArtworkTagUncheckedUpdateManyWithoutArtworkNestedInput
    images?: ImageUncheckedUpdateManyWithoutArtworkNestedInput
  }

  export type ArtworkUncheckedUpdateManyWithoutArtistInput = {
    id?: IntFieldUpdateOperationsInput | number
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    descriptionLength?: IntFieldUpdateOperationsInput | number
    directoryCreatedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    imageCount?: IntFieldUpdateOperationsInput | number
    bookmarkCount?: NullableIntFieldUpdateOperationsInput | number | null
    externalId?: NullableStringFieldUpdateOperationsInput | string | null
    isAiGenerated?: NullableBoolFieldUpdateOperationsInput | boolean | null
    originalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    size?: NullableStringFieldUpdateOperationsInput | string | null
    sourceDate?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    sourceUrl?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    xRestrict?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ArtworkTagCreateManyArtworkInput = {
    id?: number
    tagId: number
    createdAt?: Date | string
  }

  export type ImageCreateManyArtworkInput = {
    id?: number
    path: string
    width?: number | null
    height?: number | null
    size?: number | null
    sortOrder?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ArtworkTagUpdateWithoutArtworkInput = {
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tag?: TagUpdateOneRequiredWithoutArtworkTagsNestedInput
  }

  export type ArtworkTagUncheckedUpdateWithoutArtworkInput = {
    id?: IntFieldUpdateOperationsInput | number
    tagId?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtworkTagUncheckedUpdateManyWithoutArtworkInput = {
    id?: IntFieldUpdateOperationsInput | number
    tagId?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ImageUpdateWithoutArtworkInput = {
    path?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    size?: NullableIntFieldUpdateOperationsInput | number | null
    sortOrder?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ImageUncheckedUpdateWithoutArtworkInput = {
    id?: IntFieldUpdateOperationsInput | number
    path?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    size?: NullableIntFieldUpdateOperationsInput | number | null
    sortOrder?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ImageUncheckedUpdateManyWithoutArtworkInput = {
    id?: IntFieldUpdateOperationsInput | number
    path?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    size?: NullableIntFieldUpdateOperationsInput | number | null
    sortOrder?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtworkTagCreateManyTagInput = {
    id?: number
    artworkId: number
    createdAt?: Date | string
  }

  export type ArtworkTagUpdateWithoutTagInput = {
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    artwork?: ArtworkUpdateOneRequiredWithoutArtworkTagsNestedInput
  }

  export type ArtworkTagUncheckedUpdateWithoutTagInput = {
    id?: IntFieldUpdateOperationsInput | number
    artworkId?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ArtworkTagUncheckedUpdateManyWithoutTagInput = {
    id?: IntFieldUpdateOperationsInput | number
    artworkId?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use ArtistCountOutputTypeDefaultArgs instead
     */
    export type ArtistCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ArtistCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ArtworkCountOutputTypeDefaultArgs instead
     */
    export type ArtworkCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ArtworkCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TagCountOutputTypeDefaultArgs instead
     */
    export type TagCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TagCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ArtistDefaultArgs instead
     */
    export type ArtistArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ArtistDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ArtworkDefaultArgs instead
     */
    export type ArtworkArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ArtworkDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TagDefaultArgs instead
     */
    export type TagArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TagDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ArtworkTagDefaultArgs instead
     */
    export type ArtworkTagArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ArtworkTagDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ImageDefaultArgs instead
     */
    export type ImageArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ImageDefaultArgs<ExtArgs>
    /**
     * @deprecated Use UserDefaultArgs instead
     */
    export type UserArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = UserDefaultArgs<ExtArgs>
    /**
     * @deprecated Use SettingDefaultArgs instead
     */
    export type SettingArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = SettingDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TriggerLogDefaultArgs instead
     */
    export type TriggerLogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TriggerLogDefaultArgs<ExtArgs>

  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}