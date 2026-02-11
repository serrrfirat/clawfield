#!/bin/bash
# VoxelEarth setup — install Java + clone & build the 3 Java tools
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VEDIR="$SCRIPT_DIR/voxelearth"

# Install Java if missing
if ! command -v java &>/dev/null; then
  echo "Installing Java via Homebrew..."
  brew install openjdk
  # Symlink so system Java wrappers find it
  sudo ln -sfn "$(brew --prefix openjdk)/libexec/openjdk.jdk" /Library/Java/JavaVirtualMachines/openjdk.jdk 2>/dev/null || true
fi

# Ensure Homebrew openjdk is on PATH for this session
export PATH="$(brew --prefix openjdk)/bin:$PATH"

# Install Maven if missing
if ! command -v mvn &>/dev/null; then
  echo "Installing Maven via Homebrew..."
  brew install maven
fi

echo "Java: $(java -version 2>&1 | head -1)"
echo "Maven: $(mvn -version 2>&1 | head -1)"

mkdir -p "$VEDIR/jars" "$VEDIR/repos"

for repo in java-3dtiles-downloader java-draco-decoder java-cpu-voxelizer; do
  echo ""
  echo "=== Building $repo ==="

  if [ ! -d "$VEDIR/repos/$repo" ]; then
    git clone "https://github.com/voxelearth/$repo.git" "$VEDIR/repos/$repo"
  else
    echo "  Repo already cloned, pulling latest..."
    git -C "$VEDIR/repos/$repo" pull --ff-only || true
  fi

  cd "$VEDIR/repos/$repo"
  mvn -q -DskipTests clean package
  cd "$SCRIPT_DIR"
done

# Copy fat JARs to a known location
cp "$VEDIR/repos/java-3dtiles-downloader/target/"*-all.jar "$VEDIR/jars/downloader.jar" 2>/dev/null \
  || cp "$VEDIR/repos/java-3dtiles-downloader/target/"*.jar "$VEDIR/jars/downloader.jar"

cp "$VEDIR/repos/java-draco-decoder/target/"*-all.jar "$VEDIR/jars/decoder.jar" 2>/dev/null \
  || cp "$VEDIR/repos/java-draco-decoder/target/"*.jar "$VEDIR/jars/decoder.jar"

cp "$VEDIR/repos/java-cpu-voxelizer/target/"*-all.jar "$VEDIR/jars/voxelizer.jar" 2>/dev/null \
  || cp "$VEDIR/repos/java-cpu-voxelizer/target/"*.jar "$VEDIR/jars/voxelizer.jar"

echo ""
echo "Setup complete! JARs are at:"
ls -lh "$VEDIR/jars/"
