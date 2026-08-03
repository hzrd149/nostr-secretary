{
  pkgs,
  src,
  version,
  systems,
}:
let
  inherit (pkgs) lib stdenvNoCC;

  nodeModules = stdenvNoCC.mkDerivation {
    pname = "nostr-secretary-node-modules";
    inherit version src;

    impureEnvVars = lib.fetchers.proxyImpureEnvVars ++ [
      "GIT_PROXY_COMMAND"
      "SOCKS_SERVER"
    ];

    nativeBuildInputs = [
      pkgs.bun
      pkgs.writableTmpDirAsHomeHook
    ];

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild

      export BUN_INSTALL_CACHE_DIR="$(mktemp -d)"
      bun install \
        --cpu="*" \
        --os="*" \
        --frozen-lockfile \
        --ignore-scripts \
        --no-progress \
        --production

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out"
      cp -R node_modules "$out/"

      runHook postInstall
    '';

    # Fixup can embed host-specific Nix store paths in the fixed-output tree.
    dontFixup = true;

    outputHash = "sha256-EwlqvRONWSiVAHiAXjA3F4mhOMEs6aoffH0BbKRJ2ao=";
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
  };

  nostr-secretary = stdenvNoCC.mkDerivation {
    pname = "nostr-secretary";
    inherit version src;

    nativeBuildInputs = [ pkgs.makeWrapper ];

    dontBuild = true;

    installPhase = ''
      runHook preInstall

      app="$out/share/nostr-secretary"
      mkdir -p "$app" "$out/bin"
      cp index.ts const.ts package.json bun.lock tsconfig.json "$app/"
      cp -R components helpers notifications pages public services "$app/"
      cp -R ${nodeModules}/node_modules "$app/"

      makeWrapper ${lib.getExe pkgs.bun} "$out/bin/nostr-secretary" \
        --chdir "$app" \
        --add-flags "run" \
        --add-flags "$app/index.ts"

      runHook postInstall
    '';

    meta = {
      description = "Simple Nostr notification server";
      homepage = "https://github.com/hzrd149/nostr-secretary";
      license = lib.licenses.mit;
      mainProgram = "nostr-secretary";
      platforms = systems;
    };
  };
in
{
  default = nostr-secretary;
  inherit nostr-secretary nodeModules;
}
