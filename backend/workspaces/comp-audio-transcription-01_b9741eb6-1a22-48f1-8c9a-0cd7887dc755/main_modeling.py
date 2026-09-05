import pandas as pd
import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

train_df = pd.read_csv('/home/jovyan/work/data/train.csv')
test_df = pd.read_csv('/home/jovyan/work/data/test.csv')

train_df['text_content'] = train_df['text_content'].fillna('').astype(str)
train_df['label'] = train_df['label'].fillna('').astype(str)

model = Pipeline([
    ('tfidf', TfidfVectorizer()),
    ('clf', LogisticRegression(max_iter=1000))
])

model.fit(train_df['text_content'], train_df['label'])

with open('model.pkl', 'wb') as f:
    pickle.dump(model, f)

print('Model saved to model.pkl')
