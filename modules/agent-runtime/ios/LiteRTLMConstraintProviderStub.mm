#include <stddef.h>

extern "C" {

typedef struct LiteRtLmGemmaModelConstraintProvider
    LiteRtLmGemmaModelConstraintProvider;
typedef struct LiteRtLmConstraint LiteRtLmConstraint;

typedef enum LiteRtLmGemmaFuncallFormat {
  kLiteRtLmGemmaFuncallFormatPythonStyle = 0,
  kLiteRtLmGemmaFuncallFormatFcStyle = 1,
} LiteRtLmGemmaFuncallFormat;

typedef enum LiteRtLmGemmaConstraintMode {
  kLiteRtLmGemmaConstraintModeTextAndOr = 0,
  kLiteRtLmGemmaConstraintModeFunctionCallOnly = 1,
} LiteRtLmGemmaConstraintMode;

typedef struct LiteRtLmGemmaModelConstraintOptions {
  LiteRtLmGemmaFuncallFormat funcall_format;
  LiteRtLmGemmaConstraintMode constraint_mode;
  const char *code_fence_start;
  const char *code_fence_end;
  const char *open_quote;
  const char *close_quote;
  const char *function_response_start;
} LiteRtLmGemmaModelConstraintOptions;

LiteRtLmGemmaModelConstraintProvider *LiteRtLmGemmaModelConstraintProvider_Create(
    const char *serialized_sp_model_proto, size_t serialized_sp_model_proto_len,
    const int **stop_token_ids, const size_t *stop_token_lengths,
    size_t num_stop_lists) {
  (void)serialized_sp_model_proto;
  (void)serialized_sp_model_proto_len;
  (void)stop_token_ids;
  (void)stop_token_lengths;
  (void)num_stop_lists;
  return nullptr;
}

void LiteRtLmGemmaModelConstraintProvider_Destroy(
    LiteRtLmGemmaModelConstraintProvider *provider) {
  (void)provider;
}

LiteRtLmConstraint *LiteRtLmGemmaModelConstraintProvider_CreateConstraintFromTools(
    LiteRtLmGemmaModelConstraintProvider *provider, const char *json_tools_str,
    const LiteRtLmGemmaModelConstraintOptions *options) {
  (void)provider;
  (void)json_tools_str;
  (void)options;
  return nullptr;
}

void LiteRtLmConstraint_Destroy(LiteRtLmConstraint *constraint) {
  (void)constraint;
}

}  // extern "C"
