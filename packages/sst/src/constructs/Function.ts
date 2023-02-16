/* eslint-disable @typescript-eslint/ban-types */
// Note: disabling ban-type rule so we don't get an error referencing the class Function

import path from "path";
import type { Loader, BuildOptions } from "esbuild";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";

import { App } from "./App.js";
import { Stack } from "./Stack.js";
import { Job } from "./Job.js";
import { Secret } from "./Config.js";
import { SSTConstruct } from "./Construct.js";
import { Size, toCdkSize } from "./util/size.js";
import { Duration, toCdkDuration } from "./util/duration.js";
import { bindEnvironment, bindPermissions } from "./util/functionBinding.js";
import { Permissions, attachPermissionsToRole } from "./util/permission.js";
import * as functionUrlCors from "./util/functionUrlCors.js";

import url from "url";
import { useDeferredTasks } from "./deferred_task.js";
import { useProject } from "../project.js";
import { useRuntimeHandlers } from "../runtime/handlers.js";
import { createAppContext } from "./context.js";
import { useWarning } from "./util/warning.js";
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const supportedRuntimes = {
  rust: lambda.Runtime.PROVIDED_AL2,
  nodejs: lambda.Runtime.NODEJS,
  "nodejs4.3": lambda.Runtime.NODEJS_4_3,
  "nodejs6.10": lambda.Runtime.NODEJS_6_10,
  "nodejs8.10": lambda.Runtime.NODEJS_8_10,
  "nodejs10.x": lambda.Runtime.NODEJS_10_X,
  "nodejs12.x": lambda.Runtime.NODEJS_12_X,
  "nodejs14.x": lambda.Runtime.NODEJS_14_X,
  "nodejs16.x": lambda.Runtime.NODEJS_16_X,
  "nodejs18.x": lambda.Runtime.NODEJS_18_X,
  "python2.7": lambda.Runtime.PYTHON_2_7,
  "python3.6": lambda.Runtime.PYTHON_3_6,
  "python3.7": lambda.Runtime.PYTHON_3_7,
  "python3.8": lambda.Runtime.PYTHON_3_8,
  "python3.9": lambda.Runtime.PYTHON_3_9,
  "dotnetcore1.0": lambda.Runtime.DOTNET_CORE_1,
  "dotnetcore2.0": lambda.Runtime.DOTNET_CORE_2,
  "dotnetcore2.1": lambda.Runtime.DOTNET_CORE_2_1,
  "dotnetcore3.1": lambda.Runtime.DOTNET_CORE_3_1,
  dotnet6: lambda.Runtime.DOTNET_6,
  java8: lambda.Runtime.JAVA_8,
  java11: lambda.Runtime.JAVA_11,
  "go1.x": lambda.Runtime.PROVIDED_AL2,
  go: lambda.Runtime.PROVIDED_AL2,
};

export type Runtime = keyof typeof supportedRuntimes;
export type FunctionInlineDefinition = string | Function;
export type FunctionDefinition = string | Function | FunctionProps;
export interface FunctionUrlCorsProps extends functionUrlCors.CorsProps {}

export interface FunctionHooks {
  /**
   * Hook to run before build
   */
  beforeBuild?: (props: FunctionProps, out: string) => Promise<void>;

  /**
   * Hook to run after build
   */
  afterBuild?: (props: FunctionProps, out: string) => Promise<void>;
}

export interface FunctionProps
  extends Omit<
    lambda.FunctionOptions,
    | "functionName"
    | "memorySize"
    | "timeout"
    | "runtime"
    | "tracing"
    | "layers"
    | "architecture"
    | "logRetention"
  > {
  /**
   * Used to configure additional files to copy into the function bundle
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   copyFiles: [{ from: "src/index.js" }]
   * })
   *```
   */
  copyFiles?: FunctionCopyFilesProps[];

  /**
   * Used to configure nodejs function properties
   */
  nodejs?: NodeJSProps;

  /**
   * Used to configure java function properties
   */
  java?: JavaProps;

  /**
   * Used to configure python function properties
   */
  python?: PythonProps;

  /**
   * Hooks to run before and after function builds
   */
  hooks?: FunctionHooks;

  /**
   * The CPU architecture of the lambda function.
   *
   * @default "x86_64"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   architecture: "arm_64",
   * })
   * ```
   */
  architecture?: Lowercase<
    keyof Pick<typeof lambda.Architecture, "ARM_64" | "X86_64">
  >;
  /**
   * By default, the name of the function is auto-generated by AWS. You can configure the name by providing a string.
   *
   * @default Auto-generated function name
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   functionName: "my-function",
   * })
   *```
   */
  functionName?: string | ((props: FunctionNameProps) => string);
  /**
   * Path to the entry point and handler function. Of the format:
   * `/path/to/file.function`.
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   * })
   *```
   */
  handler?: string;
  /**
   * The runtime environment for the function.
   * @default "nodejs16.x"
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "function.handler",
   *   runtime: "nodejs18.x",
   * })
   *```
   */
  runtime?: Runtime;
  /**
   * The amount of disk storage in MB allocated.
   *
   * @default "512 MB"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   diskSize: "2 GB",
   * })
   *```
   */
  diskSize?: number | Size;
  /**
   * The amount of memory in MB allocated.
   *
   * @default "1 GB"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   memorySize: "2 GB",
   * })
   *```
   */
  memorySize?: number | Size;
  /**
   * The execution timeout in seconds.
   *
   * @default "10 seconds"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   timeout: "30 seconds",
   * })
   *```
   */
  timeout?: number | Duration;
  /**
   * Enable AWS X-Ray Tracing.
   *
   * @default "active"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   tracing: "pass_through",
   * })
   *```
   */
  tracing?: Lowercase<keyof typeof lambda.Tracing>;
  /**
   * Can be used to disable Live Lambda Development when using `sst start`. Useful for things like Custom Resources that need to execute during deployment.
   *
   * @default true
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   enableLiveDev: false
   * })
   *```
   */
  enableLiveDev?: boolean;
  /**
   * Configure environment variables for the function
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   environment: {
   *     TABLE_NAME: table.tableName,
   *   }
   * })
   * ```
   */
  environment?: Record<string, string>;
  /**
   * Bind resources for the function
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   bind: [STRIPE_KEY, bucket],
   * })
   * ```
   */
  bind?: SSTConstruct[];
  /**
   * Attaches the given list of permissions to the function. Configuring this property is equivalent to calling `attachPermissions()` after the function is created.
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   permissions: ["ses"]
   * })
   * ```
   */
  permissions?: Permissions;
  /**
   * Enable function URLs, a dedicated endpoint for your Lambda function.
   * @default Disabled
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: true
   * })
   * ```
   *
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: {
   *     authorizer: "iam",
   *     cors: {
   *       allowedOrigins: ['https://example.com'],
   *     },
   *   },
   * })
   * ```
   */
  url?: boolean | FunctionUrlProps;
  /**
   * A list of Layers to add to the function's execution environment.
   *
   * Note that, if a Layer is created in a stack (say `stackA`) and is referenced in another stack (say `stackB`), SST automatically creates an SSM parameter in `stackA` with the Layer's ARN. And in `stackB`, SST reads the ARN from the SSM parameter, and then imports the Layer.
   *
   *  This is to get around the limitation that a Lambda Layer ARN cannot be referenced across stacks via a stack export. The Layer ARN contains a version number that is incremented everytime the Layer is modified. When you refer to a Layer's ARN across stacks, a CloudFormation export is created. However, CloudFormation does not allow an exported value to be updated. Once exported, if you try to deploy the updated layer, the CloudFormation update will fail. You can read more about this issue here - https://github.com/serverless-stack/sst/issues/549.
   *
   * @default no layers
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   layers: ["arn:aws:lambda:us-east-1:764866452798:layer:chrome-aws-lambda:22", myLayer]
   * })
   * ```
   */
  layers?: (string | lambda.ILayerVersion)[];
  /**
   * The duration function logs are kept in CloudWatch Logs.
   *
   * When updating this property, unsetting it doesn't retain the logs indefinitely. Explicitly set the value to "infinite".
   * @default Logs retained indefinitely
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   logRetention: "one_week"
   * })
   * ```
   */
  logRetention?: Lowercase<keyof typeof logs.RetentionDays>;
}

export interface FunctionNameProps {
  /**
   * The stack the function is being created in
   */
  stack: Stack;
  /**
   * The function properties
   */
  functionProps: FunctionProps;
}

export interface FunctionUrlProps {
  /**
   * The authorizer for the function URL
   * @default "none"
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: {
   *     authorizer: "iam",
   *   },
   * })
   * ```
   */
  authorizer?: "none" | "iam";
  /**
   * CORS support for the function URL
   * @default true
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: {
   *     cors: true,
   *   },
   * })
   * ```
   *
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: {
   *     cors: {
   *       allowedMethods: ["GET", "POST"]
   *       allowedOrigins: ['https://example.com'],
   *     },
   *   },
   * })
   * ```
   */
  cors?: boolean | FunctionUrlCorsProps;
}

export interface NodeJSProps {
  /**
   * Configure additional esbuild loaders for other file extensions
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   nodejs: {
   *     loader: {
   *      ".png": "file"
   *     }
   *   }
   * })
   * ```
   */
  loader?: Record<string, Loader>;

  /**
   * Packages that will be excluded from the bundle and installed into node_modules instead. Useful for dependencies that cannot be bundled, like those with binary dependencies.
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   nodejs: {
   *     install: ["pg"]
   *   }
   * })
   * ```
   */
  install?: string[];

  /**
   * Use this to insert an arbitrary string at the beginning of generated JavaScript and CSS files.
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   nodejs: {
   *     banner: "console.log('Function starting')"
   *   }
   * })
   * ```
   */
  banner?: string;

  /**
   * This allows you to customize esbuild config.
   */
  esbuild?: BuildOptions;

  /**
   * Enable or disable minification
   *
   * @default true
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   nodejs: {
   *     minify: false
   *   }
   * })
   * ```
   */
  minify?: boolean;
  /**
   * Configure format
   *
   * @default "cjs"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   nodejs: {
   *     format: "esm"
   *   }
   * })
   * ```
   */
  format?: "cjs" | "esm";
  /**
   * Configure if sourcemaps are generated when the function is bundled for production. Since they increase payload size and potentially cold starts they are not generated by default. They are always generated during local development mode.
   *
   * @default false
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   nodejs: {
   *     sourcemap: true
   *   }
   * })
   * ```
   */
  sourcemap?: boolean;
}

/**
 * Used to configure Python bundling options
 */
export interface PythonProps {
  /**
   * A list of commands to override the [default installing behavior](Function#bundle) for Python dependencies.
   *
   * Each string in the array is a command that'll be run. For example:
   *
   * @default "[]"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   python: {
   *     installCommands: [
   *       'export VARNAME="my value"',
   *       'pip install --index-url https://domain.com/pypi/myprivatemodule/simple/ --extra-index-url https://pypi.org/simple -r requirements.txt .',
   *     ]
   *   }
   * })
   * ```
   */
  installCommands?: string[];
}

/**
 * Used to configure Java package build options
 */
export interface JavaProps {
  /**
   * Gradle build command to generate the bundled .zip file.
   *
   * @default "build"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   java: {
   *     buildTask: "bundle"
   *   }
   * })
   * ```
   */
  buildTask?: string;
  /**
   * The output folder that the bundled .zip file will be created within.
   *
   * @default "distributions"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   java: {
   *     buildOutputDir: "output"
   *   }
   * })
   * ```
   */
  buildOutputDir?: string;
  /**
   * Use custom Amazon Linux runtime instead of Java runtime.
   *
   * @default Not using provided runtime
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   java: {
   *     experimentalUseProvidedRuntime: "provided.al2"
   *   }
   * })
   * ```
   */
  experimentalUseProvidedRuntime?: "provided" | "provided.al2";
}

/**
 * Used to configure additional files to copy into the function bundle
 *
 * @example
 * ```js
 * new Function(stack, "Function", {
 *   copyFiles: [{ from: "src/index.js" }]
 * })
 *```
 */
export interface FunctionCopyFilesProps {
  /**
   * Source path relative to sst.json
   */
  from: string;
  /**
   * Destination path relative to function root in bundle
   */
  to?: string;
}

/**
 * The `Function` construct is a higher level CDK construct that makes it easy to create a Lambda Function with support for Live Lambda Development.
 *
 * @example
 *
 * ```js
 * import { Function } from "@serverless-stack/resources";
 *
 * new Function(stack, "MySnsLambda", {
 *   handler: "src/sns/index.main",
 * });
 * ```
 */
export class Function extends lambda.Function implements SSTConstruct {
  public readonly id: string;
  public readonly _isLiveDevEnabled: boolean;
  /** @internal */
  public _disableBind?: boolean;
  private functionUrl?: lambda.FunctionUrl;
  private props: FunctionProps;

  constructor(scope: Construct, id: string, props: FunctionProps) {
    const app = scope.node.root as App;
    const stack = Stack.of(scope) as Stack;

    // Merge with app defaultFunctionProps
    // note: reverse order so later prop override earlier ones
    stack.defaultFunctionProps
      .slice()
      .reverse()
      .forEach((per) => {
        props = Function.mergeProps(per, props);
      });
    props.runtime = props.runtime || "nodejs16.x";
    if (props.runtime === "go1.x") useWarning().add("go.deprecated");

    // Set defaults
    const functionName =
      props.functionName &&
      (typeof props.functionName === "string"
        ? props.functionName
        : props.functionName({ stack, functionProps: props }));
    const handler = props.handler;
    const timeout = Function.normalizeTimeout(props.timeout);
    const architecture = (() => {
      if (props.architecture === "arm_64") return lambda.Architecture.ARM_64;
      if (props.architecture === "x86_64") return lambda.Architecture.X86_64;
      return undefined;
    })();
    const memorySize = Function.normalizeMemorySize(props.memorySize);
    const diskSize = Function.normalizeDiskSize(props.diskSize);
    const tracing =
      lambda.Tracing[
        (props.tracing || "active").toUpperCase() as keyof typeof lambda.Tracing
      ];
    const logRetention =
      props.logRetention &&
      logs.RetentionDays[
        props.logRetention.toUpperCase() as keyof typeof logs.RetentionDays
      ];
    const isLiveDevEnabled = props.enableLiveDev === false ? false : true;

    // Validate handler
    if (!handler) {
      throw new Error(`No handler defined for the "${id}" Lambda function`);
    }

    // Validate input
    const isNodeRuntime = props.runtime.startsWith("nodejs");

    // Handle local development (ie. sst start)
    // - set runtime to nodejs12.x for non-Node runtimes (b/c the stub is in Node)
    // - set retry to 0. When the debugger is disconnected, the Cron construct
    //   will still try to periodically invoke the Lambda, and the requests would
    //   fail and retry. So when launching `sst start`, a couple of retry requests
    //   from recent failed request will be received. And this behavior is confusing.
    if (isLiveDevEnabled && app.mode === "dev") {
      // If debugIncreaseTimeout is enabled:
      //   set timeout to 900s. This will give people more time to debug the function
      //   without timing out the request. Note API Gateway requests have a maximum
      //   timeout of 29s. In this case, the API will timeout, but the Lambda function
      //   will continue to run.
      let debugOverrideProps;
      if (app.debugIncreaseTimeout) {
        debugOverrideProps = {
          timeout: cdk.Duration.seconds(900),
        };
      }

      super(scope, id, {
        ...props,
        architecture,
        code: lambda.Code.fromAsset(
          path.resolve(__dirname, "../support/bridge")
        ),
        handler: "bridge.handler",
        functionName,
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize,
        ephemeralStorageSize: diskSize,
        timeout,
        tracing,
        environment: props.environment,
        layers: [],
        logRetention,
        retryAttempts: 0,
        ...(debugOverrideProps || {}),
      });
      this.addEnvironment("SST_FUNCTION_ID", this.node.addr);
      this.attachPermissions([
        new iam.PolicyStatement({
          actions: ["iot:*"],
          effect: iam.Effect.ALLOW,
          resources: ["*"],
        }),
      ]);
    }
    // Handle remove (ie. sst remove)
    else if (app.skipBuild) {
      // Note: need to override runtime as CDK does not support inline code
      //       for some runtimes.
      super(scope, id, {
        ...props,
        architecture,
        code: lambda.Code.fromInline("export function placeholder() {}"),
        handler: "index.placeholder",
        functionName,
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize,
        ephemeralStorageSize: diskSize,
        timeout,
        tracing,
        environment: props.environment,
        layers: Function.buildLayers(scope, id, props),
        logRetention,
      });
    }
    // Handle build
    else {
      super(scope, id, {
        ...props,
        architecture,
        code: lambda.Code.fromInline("export function placeholder() {}"),
        handler: "index.placeholder",
        functionName,
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize,
        ephemeralStorageSize: diskSize,
        timeout,
        tracing,
        environment: props.environment,
        layers: Function.buildLayers(scope, id, props),
        logRetention,
      });

      useDeferredTasks().add(async () => {
        // Build function
        const result = await useRuntimeHandlers().build(
          this.node.addr,
          "deploy"
        );
        if (result.type === "error") {
          throw new Error(
            [
              `Failed to build function "${props.handler}"`,
              ...result.errors,
            ].join("\n")
          );
        }
        const code = lambda.AssetCode.fromAsset(result.out);

        // Update function's code
        const codeConfig = code.bind(this);
        const cfnFunction = this.node.defaultChild as lambda.CfnFunction;
        cfnFunction.runtime =
          supportedRuntimes[
            props.runtime as keyof typeof supportedRuntimes
          ].toString();
        /*
        if (isJavaRuntime) {
          const providedRuntime = (bundle as FunctionBundleJavaProps)
            .experimentalUseProvidedRuntime;
          if (providedRuntime) {
            cfnFunction.runtime = providedRuntime;
          }
        }
        */
        cfnFunction.code = {
          s3Bucket: codeConfig.s3Location?.bucketName,
          s3Key: codeConfig.s3Location?.objectKey,
          s3ObjectVersion: codeConfig.s3Location?.objectVersion,
        };
        cfnFunction.handler = result.handler;
        code.bindToResource(cfnFunction);
      });
    }

    this.id = id;
    this.props = props || {};

    if (isNodeRuntime) {
      // Enable reusing connections with Keep-Alive for NodeJs
      // Lambda function
      this.addEnvironment("AWS_NODEJS_CONNECTION_REUSE_ENABLED", "1", {
        removeInEdge: true,
      });
    }

    // Attach permissions
    this.attachPermissions(props.permissions || []);

    // Add config
    this.addEnvironment("SST_APP", app.name, { removeInEdge: true });
    this.addEnvironment("SST_STAGE", app.stage, { removeInEdge: true });
    this.addEnvironment("SST_SSM_PREFIX", useProject().config.ssmPrefix, {
      removeInEdge: true,
    });
    this.bind(props.bind || []);

    this.createUrl();

    this._isLiveDevEnabled = isLiveDevEnabled;
    useFunctions().add(this.node.addr, props);
  }

  /**
   * The AWS generated URL of the Function.
   */
  public get url(): string | undefined {
    return this.functionUrl?.url;
  }

  /**
   * Binds additional resources to function.
   *
   * @example
   * ```js
   * fn.bind([STRIPE_KEY, bucket]);
   * ```
   */
  public bind(constructs: SSTConstruct[]): void {
    constructs.forEach((c) => {
      // Bind environment
      const env = bindEnvironment(c);
      Object.entries(env).forEach(([key, value]) =>
        this.addEnvironment(key, value)
      );

      // Bind permissions
      const permissions = bindPermissions(c);
      Object.entries(permissions).forEach(([action, resources]) =>
        this.attachPermissions([
          new iam.PolicyStatement({
            actions: [action],
            effect: iam.Effect.ALLOW,
            resources,
          }),
        ])
      );
    });
  }

  /**
   * Attaches additional permissions to function.
   *
   * @example
   * ```js {20}
   * fn.attachPermissions(["s3"]);
   * ```
   */
  public attachPermissions(permissions: Permissions): void {
    // Grant IAM permissions
    if (this.role) {
      attachPermissionsToRole(this.role as iam.Role, permissions);
    }

    // Add config
    if (permissions !== "*") {
      permissions
        .filter((p) => p instanceof Job)
        .forEach((p) => this.bind([p as Job]));
    }
  }

  /** @internal */
  public getConstructMetadata() {
    const { bind } = this.props;

    return {
      type: "Function" as const,
      data: {
        arn: this.functionArn,
        localId: this.node.addr,
        secrets: (bind || [])
          .filter((c) => c instanceof Secret)
          .map((c) => (c as Secret).name),
      },
    };
  }

  /** @internal */
  public getFunctionBinding() {
    return {
      clientPackage: "function",
      variables: {
        functionName: {
          environment: this.functionName,
          parameter: this.functionName,
        },
      },
      permissions: {
        "lambda:*": [this.functionArn],
      },
    };
  }

  private createUrl() {
    const { url } = this.props;
    if (url === false || url === undefined) {
      return;
    }

    let authType;
    let cors;
    if (url === true) {
      authType = lambda.FunctionUrlAuthType.NONE;
      cors = true;
    } else {
      authType =
        url.authorizer === "iam"
          ? lambda.FunctionUrlAuthType.AWS_IAM
          : lambda.FunctionUrlAuthType.NONE;
      cors = url.cors === undefined ? true : url.cors;
    }
    this.functionUrl = this.addFunctionUrl({
      authType,
      cors: functionUrlCors.buildCorsConfig(cors),
    });
  }

  static buildLayers(scope: Construct, id: string, props: FunctionProps) {
    return (props.layers || []).map((layer) => {
      if (typeof layer === "string") {
        return lambda.LayerVersion.fromLayerVersionArn(
          scope,
          `${id}${layer}`,
          layer
        );
      }
      return Function.handleImportedLayer(scope, layer);
    });
  }

  static normalizeMemorySize(memorySize?: number | Size): number {
    if (typeof memorySize === "string") {
      return toCdkSize(memorySize).toMebibytes();
    }
    return memorySize || 1024;
  }

  static normalizeDiskSize(diskSize?: number | Size): cdk.Size {
    if (typeof diskSize === "string") {
      return toCdkSize(diskSize);
    }
    return cdk.Size.mebibytes(diskSize || 512);
  }

  static normalizeTimeout(timeout?: number | Duration): cdk.Duration {
    if (typeof timeout === "string") {
      return toCdkDuration(timeout);
    }
    return cdk.Duration.seconds(timeout || 10);
  }

  static handleImportedLayer(
    scope: Construct,
    layer: lambda.ILayerVersion
  ): lambda.ILayerVersion {
    const layerStack = Stack.of(layer);
    const currentStack = Stack.of(scope);
    // Use layer directly if:
    // - layer is created in the current stack; OR
    // - layer is imported (ie. layerArn is a string)
    if (
      layerStack === currentStack ||
      !cdk.Token.isUnresolved(layer.layerVersionArn)
    ) {
      return layer;
    }
    // layer is created from another stack
    else {
      // set stack dependency b/c layerStack need to create the SSM first
      currentStack.addDependency(layerStack);
      // store layer ARN in SSM in layer's stack
      const parameterId = `${layer.node.id}Arn-${layer.node.addr}`;
      const parameterName = `/layers/${layerStack.node.id}/${parameterId}`;
      const existingSsmParam = layerStack.node.tryFindChild(parameterId);
      if (!existingSsmParam) {
        new ssm.StringParameter(layerStack, parameterId, {
          parameterName,
          stringValue: layer.layerVersionArn,
        });
      }
      // import layer from SSM value
      const layerId = `I${layer.node.id}-${layer.node.addr}`;
      const existingLayer = scope.node.tryFindChild(layerId);
      if (existingLayer) {
        return existingLayer as lambda.LayerVersion;
      } else {
        return lambda.LayerVersion.fromLayerVersionArn(
          scope,
          layerId,
          ssm.StringParameter.valueForStringParameter(scope, parameterName)
        );
      }
    }
  }

  static isInlineDefinition(
    definition: any
  ): definition is FunctionInlineDefinition {
    return typeof definition === "string" || definition instanceof Function;
  }

  static fromDefinition(
    scope: Construct,
    id: string,
    definition: FunctionDefinition,
    inheritedProps?: FunctionProps,
    inheritErrorMessage?: string
  ): Function {
    if (typeof definition === "string") {
      const fn = new Function(scope, id, {
        ...(inheritedProps || {}),
        handler: definition,
      });
      fn._disableBind = true;
      return fn;
    } else if (definition instanceof Function) {
      if (inheritedProps && Object.keys(inheritedProps).length > 0) {
        throw new Error(
          inheritErrorMessage ||
            `Cannot inherit default props when a Function is provided`
        );
      }
      return definition;
    } else if (definition instanceof lambda.Function) {
      throw new Error(
        `Please use sst.Function instead of lambda.Function for the "${id}" Function.`
      );
    } else if ((definition as FunctionProps).handler !== undefined) {
      const fn = new Function(
        scope,
        id,
        Function.mergeProps(inheritedProps, definition)
      );
      fn._disableBind = true;
      return fn;
    }
    throw new Error(`Invalid function definition for the "${id}" Function`);
  }

  static mergeProps(
    baseProps?: FunctionProps,
    props?: FunctionProps
  ): FunctionProps {
    // Merge environment
    const environment = {
      ...(baseProps?.environment || {}),
      ...(props?.environment || {}),
    };
    const environmentProp =
      Object.keys(environment).length === 0 ? {} : { environment };

    // Merge layers
    const layers = [...(baseProps?.layers || []), ...(props?.layers || [])];
    const layersProp = layers.length === 0 ? {} : { layers };

    // Merge bind
    const bind = [...(baseProps?.bind || []), ...(props?.bind || [])];
    const bindProp = bind.length === 0 ? {} : { bind };

    // Merge permissions
    let permissionsProp;
    if (baseProps?.permissions === "*") {
      permissionsProp = { permissions: baseProps.permissions };
    } else if (props?.permissions === "*") {
      permissionsProp = { permissions: props.permissions };
    } else {
      const permissions = (baseProps?.permissions || []).concat(
        props?.permissions || []
      );
      permissionsProp = permissions.length === 0 ? {} : { permissions };
    }

    return {
      ...(baseProps || {}),
      ...(props || {}),
      ...bindProp,
      ...layersProp,
      ...environmentProp,
      ...permissionsProp,
    };
  }
}

export const useFunctions = createAppContext(() => {
  const functions: Record<string, FunctionProps> = {};

  return {
    fromID(id: string) {
      return functions[id];
    },
    add(name: string, props: FunctionProps) {
      functions[name] = props;
    },
    get all() {
      return functions;
    },
  };
});
