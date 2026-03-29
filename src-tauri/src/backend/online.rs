use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineModSearchParams {
    pub page: u32,
    pub size: u32,
    pub query: String,
    pub sort: String,
    #[serde(default)]
    pub category_id: Option<i64>,
    #[serde(default)]
    pub download_mirror: DownloadMirror,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineModSearchResult {
    pub content: Vec<OnlineModSummary>,
    pub current_page: u32,
    pub page_size: u32,
    pub total_pages: u32,
    pub total_elements: u64,
    pub has_next_page: bool,
    pub has_previous_page: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineModSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub subtitle: Option<String>,
    pub description: String,
    pub submitter: String,
    pub author_names: Vec<String>,
    pub page_url: Option<String>,
    pub download_url: String,
    pub category_name: Option<String>,
    pub views: i64,
    pub likes: i64,
    pub downloads: i64,
    pub size: i64,
    pub latest_update_added_time: Option<String>,
    pub screenshot_urls: Vec<String>,
    pub game_banana_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct OnlineModIndexEntry {
    pub version: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DownloadMirror {
    #[serde(rename = "wegfan")]
    Wegfan,
    #[serde(rename = "0x0ade")]
    ZeroX0Ade,
    #[serde(rename = "gamebanana")]
    GameBanana,
}

impl Default for DownloadMirror {
    fn default() -> Self {
        Self::Wegfan
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchEnvelope {
    data: SearchPage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchPage {
    content: Vec<SearchSubmission>,
    current_page: u32,
    page_size: u32,
    total_pages: u32,
    total_elements: u64,
    has_next_page: bool,
    has_previous_page: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchSubmission {
    submitter: String,
    page_url: Option<String>,
    category_name: Option<String>,
    #[serde(default)]
    subtitle: Option<String>,
    description: String,
    #[serde(default)]
    views: i64,
    #[serde(default)]
    likes: i64,
    #[serde(default)]
    latest_update_added_time: Option<String>,
    #[serde(default)]
    screenshots: Vec<SearchScreenshot>,
    #[serde(default)]
    credits: Vec<SearchCredit>,
    files: Vec<SearchFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchScreenshot {
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchCredit {
    authors: Vec<SearchAuthor>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchAuthor {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchFile {
    url: String,
    downloads: i64,
    size: i64,
    game_banana_id: Option<i64>,
    mods: Vec<SearchFileMod>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchFileMod {
    id: String,
    name: String,
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModListEnvelope {
    data: Vec<ModListEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModListEntry {
    name: String,
    version: String,
    submission_file: ModListFile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModListFile {
    url: String,
    #[serde(default)]
    game_banana_id: Option<i64>,
}

fn resolve_download_url(
    original_url: &str,
    game_banana_file_id: Option<i64>,
    download_mirror: DownloadMirror,
) -> String {
    match (download_mirror, game_banana_file_id) {
        (DownloadMirror::Wegfan, _) => original_url.to_string(),
        (DownloadMirror::ZeroX0Ade, Some(file_id)) => {
            format!("https://celestemodupdater.0x0a.de/banana-mirror/{file_id}.zip")
        }
        (DownloadMirror::GameBanana, Some(file_id)) => {
            format!("https://gamebanana.com/dl/{file_id}")
        }
        (_, None) => original_url.to_string(),
    }
}

fn curl_json(command: &mut Command, context: &str) -> anyhow::Result<String> {
    let output = command
        .output()
        .with_context(|| format!("Failed to launch curl for {context}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("curl failed for {context}: {stderr}");
    }

    String::from_utf8(output.stdout).context("Wegfan response is not valid UTF-8")
}

fn make_curl_command() -> Command {
    let mut command = Command::new("curl");
    command
        .arg("--fail")
        .arg("--location")
        .arg("--silent")
        .arg("--show-error")
        .arg("--user-agent")
        .arg(format!(
            "CeleMod-Wayland-Native/{} {}",
            env!("CARGO_PKG_VERSION"),
            env!("GIT_HASH")
        ));
    command
}

fn normalize_search_params(params: OnlineModSearchParams) -> OnlineModSearchParams {
    let page = params.page.max(1);
    let size = params.size.clamp(1, 50);
    let sort = match params.sort.as_str() {
        "new" | "updateAdded" | "updated" | "views" | "likes" => params.sort,
        _ => "likes".to_string(),
    };
    let category_id = params.category_id.filter(|category_id| *category_id > 0);

    OnlineModSearchParams {
        page,
        size,
        query: params.query.trim().to_string(),
        sort,
        category_id,
        download_mirror: params.download_mirror,
    }
}

fn parse_search_response(
    response: &str,
    download_mirror: DownloadMirror,
) -> anyhow::Result<OnlineModSearchResult> {
    let page: SearchEnvelope = serde_json::from_str(response)
        .with_context(|| "Failed to parse Wegfan search response".to_string())?;

    let content = page
        .data
        .content
        .into_iter()
        .filter_map(|submission| {
            let mut seen_authors = HashSet::new();
            let author_names = submission
                .credits
                .iter()
                .flat_map(|credit| credit.authors.iter())
                .filter_map(|author| {
                    let name = author.name.trim();
                    if name.is_empty() || !seen_authors.insert(name.to_string()) {
                        None
                    } else {
                        Some(name.to_string())
                    }
                })
                .collect::<Vec<_>>();
            let screenshot_urls = submission
                .screenshots
                .iter()
                .map(|screenshot| screenshot.url.clone())
                .collect::<Vec<_>>();
            let file = submission.files.into_iter().next()?;
            let mod_info = file.mods.into_iter().next()?;
            Some(OnlineModSummary {
                id: mod_info.id,
                name: mod_info.name,
                version: mod_info.version,
                subtitle: submission.subtitle,
                description: submission.description,
                submitter: submission.submitter,
                author_names,
                page_url: submission.page_url,
                download_url: resolve_download_url(&file.url, file.game_banana_id, download_mirror),
                category_name: submission.category_name,
                views: submission.views,
                likes: submission.likes,
                downloads: file.downloads,
                size: file.size,
                latest_update_added_time: submission.latest_update_added_time,
                screenshot_urls,
                game_banana_id: file.game_banana_id,
            })
        })
        .collect();

    Ok(OnlineModSearchResult {
        content,
        current_page: page.data.current_page,
        page_size: page.data.page_size,
        total_pages: page.data.total_pages,
        total_elements: page.data.total_elements,
        has_next_page: page.data.has_next_page,
        has_previous_page: page.data.has_previous_page,
    })
}

pub fn search_online_mods(params: OnlineModSearchParams) -> anyhow::Result<OnlineModSearchResult> {
    let params = normalize_search_params(params);
    let mut command = make_curl_command();
    command
        .arg("--get")
        .arg("--data-urlencode")
        .arg(format!("page={}", params.page))
        .arg("--data-urlencode")
        .arg(format!("size={}", params.size))
        .arg("--data-urlencode")
        .arg(format!("sort={}", params.sort));
    if let Some(category_id) = params.category_id {
        command
            .arg("--data-urlencode")
            .arg(format!("categoryId={category_id}"));
    }
    if !params.query.is_empty() {
        command
            .arg("--data-urlencode")
            .arg(format!("search={}", params.query));
    }
    command.arg("https://celeste.weg.fan/api/v2/submission/search");

    let response = curl_json(&mut command, "Wegfan submission search")?;
    parse_search_response(&response, params.download_mirror)
}

pub fn get_online_mod_index(
    download_mirror: DownloadMirror,
) -> anyhow::Result<HashMap<String, OnlineModIndexEntry>> {
    let mut command = make_curl_command();
    command.arg("https://celeste.weg.fan/api/v2/mod/list");
    let response = curl_json(&mut command, "Wegfan mod list")?;
    let parsed: ModListEnvelope =
        serde_json::from_str(&response).with_context(|| "Failed to parse Wegfan mod list")?;

    Ok(parsed
        .data
        .into_iter()
        .map(|entry| {
            (
                entry.name.clone(),
                OnlineModIndexEntry {
                    version: entry.version,
                    download_url: resolve_download_url(
                        &entry.submission_file.url,
                        entry.submission_file.game_banana_id,
                        download_mirror,
                    ),
                },
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_online_search_response() {
        let response = r#"{
          "data": {
            "content": [
              {
                "submitter": "DemoJameson",
                "pageUrl": "https://gamebanana.com/tools/6597",
                "categoryName": "Other/Misc",
                "description": "<p>Speedrun helper</p>",
                "files": [
                  {
                    "url": "https://celeste.weg.fan/api/v2/download/files/123",
                    "downloads": 321,
                    "size": 654321,
                    "gameBananaId": 123,
                    "mods": [
                      {
                        "id": "mod-1",
                        "name": "Speedrun Tool",
                        "version": "3.0.0"
                      }
                    ]
                  }
                ]
              }
            ],
            "currentPage": 2,
            "pageSize": 10,
            "totalPages": 7,
            "totalElements": 61,
            "hasNextPage": true,
            "hasPreviousPage": true
          }
        }"#;

        let parsed =
            parse_search_response(response, DownloadMirror::Wegfan).expect("response should parse");
        assert_eq!(parsed.current_page, 2);
        assert_eq!(parsed.total_elements, 61);
        assert_eq!(parsed.content.len(), 1);
        assert_eq!(parsed.content[0].name, "Speedrun Tool");
        assert_eq!(
            parsed.content[0].download_url,
            "https://celeste.weg.fan/api/v2/download/files/123"
        );
    }

    #[test]
    fn parses_online_mod_index() {
        let response = r#"{
          "data": [
            {
              "name": "Speedrun Tool",
              "version": "3.0.0",
              "submissionFile": {
                "url": "https://celeste.weg.fan/api/v2/download/files/123"
              }
            },
            {
              "name": "CollabUtils2",
              "version": "1.9.2",
              "submissionFile": {
                "url": "https://celeste.weg.fan/api/v2/download/files/456"
              }
            }
          ]
        }"#;

        let parsed: ModListEnvelope =
            serde_json::from_str(response).expect("index response should parse");
        let index = parsed
            .data
            .into_iter()
            .map(|entry| {
                (
                    entry.name.clone(),
                    OnlineModIndexEntry {
                        version: entry.version,
                        download_url: resolve_download_url(
                            &entry.submission_file.url,
                            entry.submission_file.game_banana_id,
                            DownloadMirror::Wegfan,
                        ),
                    },
                )
            })
            .collect::<HashMap<_, _>>();

        assert_eq!(
            index["Speedrun Tool"].download_url,
            "https://celeste.weg.fan/api/v2/download/files/123"
        );
        assert_eq!(index["CollabUtils2"].version, "1.9.2");
    }

    #[test]
    fn rewrites_download_urls_for_mirrors() {
        assert_eq!(
            resolve_download_url(
                "https://celeste.weg.fan/api/v2/download/files/123",
                Some(123),
                DownloadMirror::ZeroX0Ade,
            ),
            "https://celestemodupdater.0x0a.de/banana-mirror/123.zip"
        );
        assert_eq!(
            resolve_download_url(
                "https://celeste.weg.fan/api/v2/download/files/123",
                Some(123),
                DownloadMirror::GameBanana,
            ),
            "https://gamebanana.com/dl/123"
        );
    }

    #[test]
    fn normalizes_search_params_with_category_filter() {
        let normalized = normalize_search_params(OnlineModSearchParams {
            page: 0,
            size: 200,
            query: "  Strawberry Jam  ".to_string(),
            sort: "bogus".to_string(),
            category_id: Some(6800),
            download_mirror: DownloadMirror::Wegfan,
        });

        assert_eq!(normalized.page, 1);
        assert_eq!(normalized.size, 50);
        assert_eq!(normalized.query, "Strawberry Jam");
        assert_eq!(normalized.sort, "likes");
        assert_eq!(normalized.category_id, Some(6800));
    }
}
