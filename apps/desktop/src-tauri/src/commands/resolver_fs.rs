use oxc_resolver::{FileMetadata, FileSystem, ResolveError};
use std::{
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

pub struct ResolverFs {
    pub root: PathBuf,
    pub limited: Arc<AtomicBool>,
    bytes: AtomicU64,
    started: Instant,
}

impl ResolverFs {
    pub fn for_root(root: PathBuf, limited: Arc<AtomicBool>) -> Self {
        Self {
            root,
            limited,
            bytes: AtomicU64::new(0),
            started: Instant::now(),
        }
    }
    fn checked(&self, path: &Path) -> io::Result<PathBuf> {
        if self.started.elapsed() > Duration::from_secs(20) {
            self.limited.store(true, Ordering::Relaxed);
            return Err(io::Error::other("Resolver time limit reached"));
        }
        let canonical = path.canonicalize()?;
        if !self.root.is_absolute() || !canonical.starts_with(&self.root) {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Outside repository",
            ));
        }
        Ok(canonical)
    }
}

impl FileSystem for ResolverFs {
    fn new() -> Self {
        Self::for_root(PathBuf::new(), Arc::new(AtomicBool::new(false)))
    }
    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        let canonical = self.checked(path)?;
        let mut bytes = Vec::new();
        std::fs::File::open(canonical)?
            .take(512 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        let total = self.bytes.fetch_add(bytes.len() as u64, Ordering::Relaxed);
        if bytes.len() > 512 * 1024 || total + bytes.len() as u64 > 32 * 1024 * 1024 {
            self.limited.store(true, Ordering::Relaxed);
            return Err(io::Error::other(
                "Resolver configuration read limit reached",
            ));
        }
        Ok(bytes)
    }
    fn read_to_string(&self, path: &Path) -> io::Result<String> {
        String::from_utf8(self.read(path)?).map_err(io::Error::other)
    }
    fn metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        std::fs::metadata(self.checked(path)?).map(Into::into)
    }
    fn symlink_metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        self.checked(path)?;
        std::fs::symlink_metadata(path).map(Into::into)
    }
    fn read_link(&self, path: &Path) -> Result<PathBuf, ResolveError> {
        self.checked(path).map_err(Into::into)
    }
    fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
        self.checked(path)
    }
}
