import pandas as pd
import pickle

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.svm import LinearSVC
from sklearn.pipeline import Pipeline
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

# =========================
# Load data - SAME PATHS
# =========================

train_df = pd.read_csv('/home/jovyan/work/data/train.csv')
test_df = pd.read_csv('/home/jovyan/work/data/test.csv')

# =========================
# Prepare train data
# =========================

train_df['text_content'] = train_df['text_content'].fillna('').astype(str)
train_df['label'] = train_df['label'].fillna('').astype(str).str.strip().str.lower()

# =========================
# Prepare test data
# =========================

if 'text_content' in test_df.columns:
    test_text_col = 'text_content'
elif 'text' in test_df.columns:
    test_text_col = 'text'
else:
    raise ValueError("Test file must contain either 'text_content' or 'text' column.")

if 'label' not in test_df.columns:
    raise ValueError("Test file must contain 'label' column to calculate accuracy.")

test_df[test_text_col] = test_df[test_text_col].fillna('').astype(str)
test_df['label'] = test_df['label'].fillna('').astype(str).str.strip().str.lower()

X_train = train_df['text_content']
y_train = train_df['label']

X_test = test_df[test_text_col]
y_test = test_df['label']

# =========================
# Better fast model
# =========================

model = Pipeline([
    ('tfidf', TfidfVectorizer(
        lowercase=True,
        stop_words='english',
        ngram_range=(1, 2),
        max_features=20000,
        sublinear_tf=True
    )),
    ('clf', LinearSVC(
        C=1.0,
        class_weight='balanced',
        max_iter=3000
    ))
])

# =========================
# Train
# =========================

model.fit(X_train, y_train)

# =========================
# Test
# =========================

y_pred = model.predict(X_test)

accuracy = accuracy_score(y_test, y_pred)

print("Accuracy:", accuracy)
print("Accuracy percentage:", round(accuracy * 100, 2), "%")

print("\nClassification Report:")
print(classification_report(y_test, y_pred))

print("\nConfusion Matrix:")
print(confusion_matrix(y_test, y_pred))

# =========================
# Save model
# =========================

with open('model.pkl', 'wb') as f:
    pickle.dump(model, f)

print("\nBetter fast model saved to model.pkl")
