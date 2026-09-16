use serde::Serialize;
use tree_sitter::Node;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseSymbol {
    pub name: String,
    pub line: usize,
    pub kind: String,
}

pub(super) fn declaration(node: Node<'_>, text: &str) -> Option<CodebaseSymbol> {
    let kind = match node.kind() {
        "function_declaration"
        | "generator_function_declaration"
        | "function_item"
        | "function_signature_item" => "function",
        "method_definition" | "method_signature" => "method",
        "class_declaration" | "abstract_class_declaration" => "class",
        "interface_declaration" | "trait_item" => "interface",
        "type_alias_declaration" | "type_item" => "type",
        "enum_declaration" | "enum_item" => "enum",
        "struct_item" => "struct",
        "variable_declarator" | "const_item" | "static_item" => "binding",
        _ => return None,
    };
    let identifier = node.child_by_field_name("name")?;
    if !matches!(
        identifier.kind(),
        "identifier" | "type_identifier" | "property_identifier"
    ) {
        return None;
    }
    let name = identifier.utf8_text(text.as_bytes()).ok()?;
    if name.len() > 120 || name.is_empty() {
        return None;
    }
    Some(CodebaseSymbol {
        name: name.into(),
        line: node.start_position().row + 1,
        kind: kind.into(),
    })
}
