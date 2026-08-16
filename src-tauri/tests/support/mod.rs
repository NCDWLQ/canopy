// Shared by every integration-test binary; not every binary uses every
// helper, so unused items here are expected.
#![allow(dead_code)]

use std::{
    io::{Read, Write},
    net::TcpListener,
    str::FromStr,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use canopy_lib::database::MIGRATION_CATALOG;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};

pub fn run_async(test: impl std::future::Future<Output = ()>) {
    tauri::async_runtime::block_on(test);
}

/// Minimal one-shot HTTP server for protocol tests: captures the full request
/// (headers + body) and replays a fixed status, headers, and SSE chunk
/// sequence with a delay between chunks.
pub struct TestServer {
    pub endpoint: String,
    pub address: String,
    request: Arc<Mutex<Option<String>>>,
    requests: Arc<Mutex<Vec<String>>>,
    handle: thread::JoinHandle<()>,
}

/// One canned response in a [`TestServer::spawn_sequence`] series.
pub struct SequenceResponse {
    pub status: String,
    pub headers: Vec<(String, String)>,
    pub chunks: Vec<Vec<u8>>,
}

impl SequenceResponse {
    pub fn json(status: &str, body: &str) -> Self {
        Self {
            status: status.to_owned(),
            headers: vec![("Content-Type".to_owned(), "application/json".to_owned())],
            chunks: vec![body.as_bytes().to_vec()],
        }
    }
}

impl TestServer {
    pub fn spawn(status: &str, extra_headers: &[(&str, &str)], chunks: Vec<Vec<u8>>) -> Self {
        Self::spawn_with_delay(status, extra_headers, chunks, Duration::from_millis(2))
    }

    /// Serves one connection per entry, in order. Each response closes the
    /// connection, so sequential client requests map one-to-one onto entries.
    pub fn spawn_sequence(responses: Vec<SequenceResponse>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let request = Arc::new(Mutex::new(None));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&request);
        let captured_all = Arc::clone(&requests);
        let handle = thread::spawn(move || {
            let mut first_request: Option<String> = None;
            for response in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 4096];
                let header_end = loop {
                    let count = stream.read(&mut buffer).unwrap();
                    if count == 0 {
                        return;
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(index) =
                        bytes.windows(4).position(|window| window == b"\r\n\r\n")
                    {
                        break index + 4;
                    }
                };
                let headers_text = String::from_utf8_lossy(&bytes[..header_end]);
                let content_length = headers_text
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                while bytes.len() < header_end + content_length {
                    let count = stream.read(&mut buffer).unwrap();
                    if count == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                }
                let request_text = String::from_utf8_lossy(&bytes).into_owned();
                if first_request.is_none() {
                    first_request = Some(request_text.clone());
                }
                captured_all.lock().unwrap().push(request_text);

                let response_length: usize = response.chunks.iter().map(Vec::len).sum();
                write!(
                    stream,
                    "HTTP/1.1 {}\r\nContent-Length: {response_length}\r\nConnection: close\r\n",
                    response.status
                )
                .unwrap();
                for (name, value) in response.headers {
                    write!(stream, "{name}: {value}\r\n").unwrap();
                }
                write!(stream, "\r\n").unwrap();
                stream.flush().unwrap();
                for chunk in response.chunks {
                    if stream.write_all(&chunk).is_err() {
                        break;
                    }
                    let _ = stream.flush();
                }
            }
            *captured.lock().unwrap() = first_request;
        });
        Self {
            endpoint: format!("http://{address}/v1"),
            address: address.to_string(),
            request,
            requests,
            handle,
        }
    }

    pub fn spawn_with_delay(
        status: &str,
        extra_headers: &[(&str, &str)],
        chunks: Vec<Vec<u8>>,
        chunk_delay: Duration,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let request = Arc::new(Mutex::new(None));
        let captured = Arc::clone(&request);
        let status = status.to_owned();
        let headers = extra_headers
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect::<Vec<_>>();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 4096];
            let header_end = loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    return;
                }
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                    break index + 4;
                }
            };
            let headers_text = String::from_utf8_lossy(&bytes[..header_end]);
            let content_length = headers_text
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|value| value.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            while bytes.len() < header_end + content_length {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
            }
            *captured.lock().unwrap() = Some(String::from_utf8_lossy(&bytes).into_owned());

            let response_length: usize = chunks.iter().map(Vec::len).sum();
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {response_length}\r\nConnection: close\r\n"
            )
            .unwrap();
            for (name, value) in headers {
                write!(stream, "{name}: {value}\r\n").unwrap();
            }
            write!(stream, "\r\n").unwrap();
            stream.flush().unwrap();
            for chunk in chunks {
                if stream.write_all(&chunk).is_err() {
                    break;
                }
                let _ = stream.flush();
                thread::sleep(chunk_delay);
            }
        });
        Self {
            endpoint: format!("http://{address}/v1"),
            address: address.to_string(),
            request,
            requests: Arc::new(Mutex::new(Vec::new())),
            handle,
        }
    }

    pub fn finish(self) -> String {
        self.handle.join().unwrap();
        self.request.lock().unwrap().take().unwrap()
    }

    /// Waits for the server thread and returns every captured request in
    /// order; only meaningful for [`TestServer::spawn_sequence`].
    pub fn finish_all(self) -> Vec<String> {
        self.handle.join().unwrap();
        std::mem::take(&mut *self.requests.lock().unwrap())
    }
}

pub fn sse_event(event: &str, data: &str) -> Vec<u8> {
    format!("event: {event}\ndata: {data}\n\n").into_bytes()
}

pub fn sse(data: &str) -> Vec<u8> {
    format!("data: {data}\n\n").into_bytes()
}

pub async fn migrated_pool() -> SqlitePool {
    migrated_pool_through(i64::MAX).await
}

pub async fn migrated_pool_through(version: i64) -> SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("in-memory SQLite URL is valid")
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("test database connects");

    for migration in MIGRATION_CATALOG
        .iter()
        .filter(|migration| migration.version <= version)
    {
        sqlx::raw_sql(migration.sql)
            .execute(&pool)
            .await
            .unwrap_or_else(|error| panic!("migration {} failed: {error}", migration.version));
    }

    pool
}
