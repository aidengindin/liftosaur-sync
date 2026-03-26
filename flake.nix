{
  description = "Sync Liftosaur workouts to Intervals.icu and/or Strava";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_22;

        liftosaur-sync = pkgs.buildNpmPackage {
          pname = "liftosaur-sync";
          version = "1.0.0";
          src = ./.;
          inherit nodejs;

          # Run `nix build` once with this set to lib.fakeHash, then replace it
          # with the hash printed in the error message.
          npmDepsHash = "sha256-9Zkxa5HEPtYG0+WkV+L90JP14HvPQzVdN8ctKkrGHSY=";

          # better-sqlite3 compiles a native .node binding via node-gyp
          nativeBuildInputs = with pkgs; [
            python3
            makeWrapper
            autoPatchelfHook
          ];

          buildInputs = with pkgs; [
            stdenv.cc.cc.lib
          ];

          buildPhase = ''
            runHook preBuild
            npm run build
            npm prune --omit=dev
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p $out/lib/liftosaur-sync $out/bin

            cp -r dist node_modules package.json $out/lib/liftosaur-sync/

            makeWrapper ${nodejs}/bin/node $out/bin/liftosaur-sync \
              --add-flags "$out/lib/liftosaur-sync/dist/index.js"

            makeWrapper ${nodejs}/bin/node $out/bin/liftosaur-sync-cli \
              --add-flags "$out/lib/liftosaur-sync/dist/cli.js"

            runHook postInstall
          '';
        };
      in
      {
        packages = {
          default = liftosaur-sync;
          dockerImage = pkgs.dockerTools.buildLayeredImage {
            name = "ghcr.io/aidengindin/liftosaur-sync";
            tag = "latest";
            contents = [ liftosaur-sync pkgs.cacert pkgs.dockerTools.fakeNss ];
            extraCommands = "mkdir -p data";
            config = {
              Entrypoint = [ "${liftosaur-sync}/bin/liftosaur-sync" ];
              ExposedPorts = { "3000/tcp" = {}; };
              WorkingDir = "/data";
              User = "nobody";
              Env = [ "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt" ];
            };
          };
        };

        apps = {
          # HTTP server (default)
          default = {
            type = "app";
            program = "${liftosaur-sync}/bin/liftosaur-sync";
          };
          # One-shot CLI sync
          sync = {
            type = "app";
            program = "${liftosaur-sync}/bin/liftosaur-sync-cli";
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            python3   # node-gyp (for better-sqlite3)
            sqlite    # inspect sync-state.db
          ];
          shellHook = ''
            echo "liftosaur-sync dev shell"
            echo "  npm run dev   — start server with ts-node"
            echo "  npm run sync  — one-shot CLI sync"
            echo "  npm run build — compile TypeScript"
          '';
        };
      }
    )

    //

    {
      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.liftosaur-sync;
          pkg = self.packages.${pkgs.system}.default;
        in
        {
          options.services.liftosaur-sync = {
            enable = lib.mkEnableOption "liftosaur-sync workout sync server";

            environmentFile = lib.mkOption {
              type = lib.types.path;
              description = ''
                Path to a file containing environment variables with API secrets.
                Must contain at minimum LIFTOSAUR_API_KEY, plus credentials for
                any enabled destination (INTERVALS_API_KEY / INTERVALS_ATHLETE_ID
                and/or STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET).
                See .env.example in the source for the full list.
              '';
              example = "/run/secrets/liftosaur-sync";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 3000;
              description = "Port for the HTTP server.";
            };

            baseUrl = lib.mkOption {
              type = lib.types.str;
              default = "http://localhost:3000";
              description = ''
                Publicly reachable base URL of this server.
                Used to build the Strava OAuth redirect URI.
              '';
              example = "https://sync.example.com";
            };

            stateDir = lib.mkOption {
              type = lib.types.str;
              default = "/var/lib/liftosaur-sync";
              description = "Directory where sync-state.db is stored.";
            };

            syncIntervals = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = ''
                If set, a systemd timer fires this often to trigger an incremental
                sync via the CLI (in addition to the always-running HTTP server).
                Uses systemd calendar syntax, e.g. "hourly" or "*:0/30".
              '';
              example = "hourly";
            };
          };

          config = lib.mkIf cfg.enable {
            users.users.liftosaur-sync = {
              isSystemUser = true;
              group = "liftosaur-sync";
              home = cfg.stateDir;
              createHome = true;
              description = "liftosaur-sync service user";
            };
            users.groups.liftosaur-sync = { };

            systemd.services.liftosaur-sync = {
              description = "Liftosaur workout sync server";
              wantedBy = [ "multi-user.target" ];
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];

              serviceConfig = {
                ExecStart = "${pkg}/bin/liftosaur-sync";
                User = "liftosaur-sync";
                Group = "liftosaur-sync";
                WorkingDirectory = cfg.stateDir;
                EnvironmentFile = cfg.environmentFile;
                Environment = [
                  "PORT=${toString cfg.port}"
                  "BASE_URL=${cfg.baseUrl}"
                  "DB_PATH=${cfg.stateDir}/sync-state.db"
                ];
                Restart = "on-failure";
                RestartSec = "5s";

                # Hardening
                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                ReadWritePaths = [ cfg.stateDir ];
                CapabilityBoundingSet = "";
                RestrictAddressFamilies = [ "AF_INET" "AF_INET6" ];
                RestrictNamespaces = true;
                LockPersonality = true;
                MemoryDenyWriteExecute = false; # required for better-sqlite3 JIT
                RestrictRealtime = true;
                SystemCallFilter = [ "@system-service" ];
              };
            };

            # Optional periodic sync timer
            systemd.services.liftosaur-sync-timer-run = lib.mkIf (cfg.syncIntervals != null) {
              description = "Liftosaur incremental sync (timer triggered)";
              after = [ "network-online.target" "liftosaur-sync.service" ];
              wants = [ "network-online.target" ];

              serviceConfig = {
                Type = "oneshot";
                ExecStart = "${pkg}/bin/liftosaur-sync-cli";
                User = "liftosaur-sync";
                Group = "liftosaur-sync";
                WorkingDirectory = cfg.stateDir;
                EnvironmentFile = cfg.environmentFile;
                Environment = [
                  "DB_PATH=${cfg.stateDir}/sync-state.db"
                ];

                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                ReadWritePaths = [ cfg.stateDir ];
                CapabilityBoundingSet = "";
                RestrictAddressFamilies = [ "AF_INET" "AF_INET6" ];
                MemoryDenyWriteExecute = false;
                SystemCallFilter = [ "@system-service" ];
              };
            };

            systemd.timers.liftosaur-sync-timer-run = lib.mkIf (cfg.syncIntervals != null) {
              description = "Periodic Liftosaur sync";
              wantedBy = [ "timers.target" ];
              timerConfig = {
                OnCalendar = cfg.syncIntervals;
                Persistent = true;
              };
            };
          };
        };
    };
}
