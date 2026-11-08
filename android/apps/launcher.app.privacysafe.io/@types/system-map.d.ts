interface AppData {
  id: string;
  name: string;
  version: string;
  iconBlobURL: string | undefined;
  components: AppComponentData[];
  services: ServiceData[];
  startCmds: StartCmdData[];
  exposedFSResources: ExposedFSResource[];
}

interface AppComponentData extends web3n.caps.FormFactorSetting {
  entrypoint: string;
  runtime: web3n.caps.Runtime;
  caps: web3n.caps.RequestedCAPs | undefined;
}

interface ServiceData {
  service: string;
  implComponent: string;
  allowedCallers: web3n.caps.AllowedCallers;
}

interface StartCmdData {
  cmd: string;
  implComponent: string;
  allowedCallers: web3n.caps.AllowedCallers;
}

interface ExposedFSResource extends web3n.caps.FSResourceDescriptor {
  name: string;
}

interface AppManifestException extends web3n.RuntimeException {
  type: 'app-manifest';
  domain: string;
  componentNotFound?: true;
  entrypoint?: string;
  wrongComponentType?: true;
  serviceNotFound?: true;
  service?: string;
  commandNotFound?: true;
  command?: string;
}

interface DiagramAppData extends AppData {
  diagramId: string;
  components: DiagramAppComponentData[];
  services: AppService[];
  startCmds: AppCmd[];
  connections: {
    inThisApp: ConnectionInApp[];
    toOtherApps: ConnectionToOtherApp[];
    toPlatform: ConnectionToPlatform[];
  };
}

interface DiagramAppComponentData extends AppComponentData {
  diagramId: string;
}

interface AppService extends ServiceData {
  diagramId: string;
}

interface AppCmd extends StartCmdData {
  diagramId: string;
}

type ConnectionInApp =
  | {
      type: 'service-impl' | 'service-call';
      comp: string;
      srvName: string;
      srv: string | undefined;
    }
  | {
      type: 'command-impl' | 'command-call';
      comp: string;
      cmdName: string;
      cmd: string | undefined;
    };

type ConnectionToOtherApp =
  | {
      type: 'service-call';
      callerApp: string;
      comp: string;
      appId: string;
      srvName: string;
      srv: string | undefined;
    }
  | {
      type: 'command-call';
      callerApp: string;
      comp: string;
      appId: string;
      cmdName: string;
      cmd: string | undefined;
    };

interface ConnectionToPlatform {
  capType: 'asmail' | 'asmail-preflight' | 'user-storage' | 'keyring';
  comp: string;
}

type AppManifest = web3n.caps.AppManifest;
type GeneralAppManifest = web3n.caps.GeneralAppManifest;
type SimpleGUIAppManifest = web3n.caps.SimpleGUIAppManifest;
type GUIComponentDef = web3n.caps.GUIComponent;
type ServiceComponent = web3n.caps.ServiceComponent;
type GUIServiceComponent = web3n.caps.GUIServiceComponent;
type AppComponent = web3n.caps.AppComponent;
type AllowedCallers = web3n.caps.AllowedCallers;
type LauncherDef = web3n.caps.Launcher;
type DynamicLaunchers = web3n.caps.DynamicLaunchers;
type RPCException = web3n.rpc.RPCException;
type ShellCmdException = web3n.shell.commands.ShellCmdException;
type FSResourceDescriptor = web3n.caps.FSResourceDescriptor;
type FSResourceException = web3n.shell.FSResourceException;
type ResourcesRequest = web3n.caps.ResourcesRequest;
type UserInterfaceFormFactor = web3n.caps.UserInterfaceFormFactor;
type FormFactorSetting = web3n.caps.FormFactorSetting;
